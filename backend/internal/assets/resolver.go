package assets

import (
	"encoding/base64"
	"fmt"
	"mime"
	"net/url"
	"path"
	"strings"
)

type RemoteAsset struct {
	SourceURL   string
	ContentType string
}

func ProxyRocomImageURL(sourceURL string) string {
	assetKey, ok := RocomImageAssetKey(sourceURL)
	if !ok {
		return ""
	}
	return "/api/assets/" + assetKey
}

func ProxyRemoteImageURL(sourceURL string) string {
	assetKey, ok := remoteImageAssetKey(sourceURL)
	if !ok {
		return ""
	}
	return "/api/assets/" + assetKey
}

func RocomImageAssetKey(sourceURL string) (string, bool) {
	if !isAllowedRocomImageURL(sourceURL) {
		return "", false
	}
	return path.Join("image", "rocom", base64.RawURLEncoding.EncodeToString([]byte(strings.TrimSpace(sourceURL)))), true
}

func GamerskyImageAssetKey(sourceURL string) (string, bool) {
	if !isAllowedGamerskyImageURL(sourceURL) {
		return "", false
	}
	return path.Join("image", "gamersky", base64.RawURLEncoding.EncodeToString([]byte(strings.TrimSpace(sourceURL)))), true
}

func Resolve(assetKey string) (RemoteAsset, bool) {
	cleanKey := strings.TrimPrefix(path.Clean("/"+assetKey), "/")
	parts := strings.Split(cleanKey, "/")
	if len(parts) < 3 {
		return RemoteAsset{}, false
	}

	switch {
	case parts[0] == "tile" && parts[1] == "delta-force" && len(parts) == 5:
		folder := parts[2]
		zoom := parts[3]
		file := parts[4]
		return RemoteAsset{
			SourceURL:   fmt.Sprintf("https://game.gtimg.cn/images/dfm/cp/a20240729directory/img/%s/%s_%s", folder, zoom, file),
			ContentType: "image/jpeg",
		}, true
	case parts[0] == "tile" && parts[1] == "rocom" && len(parts) == 5:
		source := parts[2]
		zoom := parts[3]
		file := parts[4]
		return RemoteAsset{
			SourceURL:   fmt.Sprintf("https://ue.17173cdn.com/a/terra/tiles/rocom/%s/%s/%s?v1", source, zoom, file),
			ContentType: "image/png",
		}, true
	case parts[0] == "tile" && parts[1] == "hkw" && len(parts) == 5:
		region := parts[2]
		zoom := parts[3]
		file := parts[4]
		return RemoteAsset{
			SourceURL:   fmt.Sprintf("https://image.gamersky.com/webimg13/db/game_map/wangzherongyaoshijie/%s/%s/%s", region, zoom, file),
			ContentType: "image/webp",
		}, true
	case parts[0] == "icon" && parts[1] == "rocom" && len(parts) == 3:
		file := parts[2]
		return RemoteAsset{
			SourceURL:   fmt.Sprintf("https://ue.17173cdn.com/a/terra/icon/rocom/%s", file),
			ContentType: "image/png",
		}, true
	case parts[0] == "image" && parts[1] == "rocom" && len(parts) == 3:
		sourceURL, ok := decodeRocomImageSource(parts[2])
		if !ok {
			return RemoteAsset{}, false
		}
		return RemoteAsset{
			SourceURL:   sourceURL,
			ContentType: contentTypeFromURL(sourceURL),
		}, true
	case parts[0] == "image" && parts[1] == "gamersky" && len(parts) == 3:
		sourceURL, ok := decodeGamerskyImageSource(parts[2])
		if !ok {
			return RemoteAsset{}, false
		}
		return RemoteAsset{
			SourceURL:   sourceURL,
			ContentType: contentTypeFromURL(sourceURL),
		}, true
	default:
		return RemoteAsset{}, false
	}
}

func remoteImageAssetKey(sourceURL string) (string, bool) {
	switch {
	case isAllowedRocomImageURL(sourceURL):
		return RocomImageAssetKey(sourceURL)
	case isAllowedGamerskyImageURL(sourceURL):
		return GamerskyImageAssetKey(sourceURL)
	default:
		return "", false
	}
}

func decodeRocomImageSource(encoded string) (string, bool) {
	body, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", false
	}
	sourceURL := strings.TrimSpace(string(body))
	if !isAllowedRocomImageURL(sourceURL) {
		return "", false
	}
	return sourceURL, true
}

func decodeGamerskyImageSource(encoded string) (string, bool) {
	body, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", false
	}
	sourceURL := strings.TrimSpace(string(body))
	if !isAllowedGamerskyImageURL(sourceURL) {
		return "", false
	}
	return sourceURL, true
}

func isAllowedRocomImageURL(sourceURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil {
		return false
	}
	if parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "17173cdn.com" && !strings.HasSuffix(host, ".17173cdn.com") {
		return false
	}
	return parsed.Path != ""
}

func isAllowedGamerskyImageURL(sourceURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil {
		return false
	}
	if parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "gamersky.com" && !strings.HasSuffix(host, ".gamersky.com") {
		return false
	}
	return parsed.Path != ""
}

func contentTypeFromURL(sourceURL string) string {
	parsed, err := url.Parse(sourceURL)
	if err == nil {
		if contentType := mime.TypeByExtension(path.Ext(parsed.Path)); contentType != "" {
			return contentType
		}
	}
	return "application/octet-stream"
}
