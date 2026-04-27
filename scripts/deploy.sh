#!/bin/bash
set -e

# ============================================================
# DKTool 部署脚本 - 从 CNB 制品库拉取镜像并运行
# 用法: bash deploy.sh [端口]
# 默认端口: 8089（8080 已被其他服务占用）
# ============================================================

PORT="${1:-8089}"
IMAGE="docker.cnb.cool/2026jingyu/dktool/dktool:latest"
CONTAINER_NAME="dktool"

echo "========================================"
echo "  DKTool 部署脚本"
echo "  镜像: $IMAGE"
echo "  端口: $PORT"
echo "========================================"

# 1. 登录 CNB 制品库
echo ""
echo "[1/4] 登录 CNB 制品库..."
read -s -p "请输入 CNB Token: " CNB_TOKEN
echo ""
echo "$CNB_TOKEN" | docker login docker.cnb.cool -u "cnb" --password-stdin

# 2. 拉取镜像
echo ""
echo "[2/4] 拉取最新镜像..."
docker pull "$IMAGE"

# 3. 停止旧容器（如果有）
echo ""
echo "[3/4] 停止旧容器（如有）..."
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "停止并移除旧容器 ${CONTAINER_NAME}..."
    docker stop "${CONTAINER_NAME}" 2>/dev/null || true
    docker rm "${CONTAINER_NAME}" 2>/dev/null || true
else
    echo "未找到旧容器，跳过"
fi

# 4. 启动新容器
echo ""
echo "[4/4] 启动新容器..."
docker run -d \
    --name "${CONTAINER_NAME}" \
    --restart unless-stopped \
    -p "${PORT}:8080" \
    -v "dktool-data:/app/runtime-data" \
    "${IMAGE}"

echo ""
echo "========================================"
echo "  部署完成！"
echo "  访问地址: http://$(hostname -I | awk '{print $1}'):${PORT}"
echo "  查看日志: docker logs -f ${CONTAINER_NAME}"
echo "  停止服务: docker stop ${CONTAINER_NAME}"
echo "========================================"
