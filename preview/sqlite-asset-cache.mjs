import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolveDBPath() {
  const requested = process.env.DKTOOL_DB_PATH?.trim()
  if (requested) {
    return path.resolve(requested)
  }

  const primary = path.resolve(__dirname, '../backend/data/dktool.db')
  if (existsSync(primary)) {
    return primary
  }

  return path.resolve(__dirname, '../backend/data/dktool.seed.db')
}

const dbPath = resolveDBPath()

let ensurePromise = null

function resolveSqliteBinary() {
  const candidates = [
    process.env.DKTOOL_SQLITE3_BIN,
    '/usr/bin/sqlite3',
    '/opt/homebrew/bin/sqlite3',
    '/usr/local/bin/sqlite3'
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error('sqlite3 binary not found; set DKTOOL_SQLITE3_BIN')
}

const sqliteBin = resolveSqliteBinary()

function escapeSQL(value) {
  return String(value).replace(/'/g, "''")
}

function runSQLite(sql, { json = false } = {}) {
  return new Promise((resolve, reject) => {
    mkdirSync(path.dirname(dbPath), { recursive: true })

    const args = json ? ['-json', dbPath] : [dbPath]
    const child = spawn(sqliteBin, args)

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `sqlite3 exited with code ${code}`))
        return
      }

      if (!json) {
        resolve(stdout)
        return
      }

      const body = stdout.trim()
      if (!body) {
        resolve([])
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })

    child.stdin.end(sql)
  })
}

async function ensureAssetsTable() {
  if (!ensurePromise) {
    ensurePromise = runSQLite(`
      CREATE TABLE IF NOT EXISTS assets (
        asset_key TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        content_type TEXT NOT NULL,
        body BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
  }

  return ensurePromise
}

export async function getCachedAsset(assetKey) {
  await ensureAssetsTable()

  const rows = await runSQLite(
    `
      SELECT content_type AS contentType, hex(body) AS bodyHex
      FROM assets
      WHERE asset_key = '${escapeSQL(assetKey)}'
      LIMIT 1;
    `,
    { json: true }
  )

  const row = rows[0]
  if (!row) {
    return null
  }

  return {
    contentType: row.contentType,
    body: Buffer.from(row.bodyHex || '', 'hex')
  }
}

export async function saveCachedAsset(assetKey, sourceURL, contentType, body) {
  await ensureAssetsTable()

  const bodyHex = Buffer.from(body).toString('hex')
  await runSQLite(`
    INSERT INTO assets (asset_key, source_url, content_type, body, updated_at)
    VALUES (
      '${escapeSQL(assetKey)}',
      '${escapeSQL(sourceURL)}',
      '${escapeSQL(contentType)}',
      X'${bodyHex}',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(asset_key) DO UPDATE SET
      source_url = excluded.source_url,
      content_type = excluded.content_type,
      body = excluded.body,
      updated_at = CURRENT_TIMESTAMP;
  `)
}

export async function readAssetStats() {
  await ensureAssetsTable()

  const rows = await runSQLite(
    `
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(LENGTH(body)), 0) AS totalBytes
      FROM assets;
    `,
    { json: true }
  )

  const row = rows[0] ?? {}
  return {
    count: Number(row.count || 0),
    totalBytes: Number(row.totalBytes || 0)
  }
}
