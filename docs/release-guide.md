# Release Guide — leduyphuc1702/opencode-workflow

Hướng dẫn cho AI agent publish releases đúng chuẩn để auto-update hoạt động.

## Thông tin repo

- **Owner:** leduyphuc1702
- **Repo:** opencode-workflow
- **Branch mặc định:** dev
- **Update mechanism:** CLI + Desktop đều check GitHub Releases API tại `api.github.com/repos/leduyphuc1702/opencode-workflow/releases/latest`

## Quy trình publish release

### 1. Xác định version mới

```bash
# Xem version hiện tại
cat packages/opencode/package.json | jq .version
```

Version tuân theo semver: `MAJOR.MINOR.PATCH`

### 2. Tạo GitHub Release

**Tag format BẮT BUỘC:** `vX.Y.Z` (ví dụ: `v1.15.10`)

```bash
# Tạo tag
git tag v<VERSION>
git push origin v<VERSION>

# Tạo release qua gh CLI
gh release create v<VERSION> \
  --repo leduyphuc1702/opencode-workflow \
  --title "v<VERSION>" \
  --notes "Release notes here" \
  --target dev
```

### 3. Upload binary assets (nếu có)

CLI update qua curl/GitHub cần binary assets trong release:

```
opencode-darwin-arm64.zip    # macOS Apple Silicon
opencode-darwin-x64.zip      # macOS Intel
opencode-linux-arm64.tar.gz  # Linux ARM
opencode-linux-x64.tar.gz    # Linux x64
```

```bash
# Upload assets
gh release upload v<VERSION> \
  --repo leduyphuc1702/opencode-workflow \
  opencode-darwin-arm64.zip \
  opencode-darwin-x64.zip \
  opencode-linux-arm64.tar.gz \
  opencode-linux-x64.tar.gz
```

### 4. Desktop app (electron-updater)

Desktop auto-updater cần thêm các file metadata trong release:

```
latest-mac.yml          # macOS update manifest
latest-linux.yml        # Linux update manifest
latest.yml              # Windows update manifest
```

Các file này được electron-builder tự generate khi build desktop app:

```bash
# Build desktop từ packages/desktop
bun run build
# Output sẽ có .yml manifests cùng installer files
```

Upload tất cả output artifacts lên cùng release.

## Checklist trước khi publish

- [ ] Version trong package.json đã bump
- [ ] Tag format đúng: `vX.Y.Z`
- [ ] Release KHÔNG phải draft (auto-update chỉ thấy published releases)
- [ ] Binary assets đã upload (nếu support CLI update)
- [ ] Desktop manifests đã upload (nếu support desktop update)

## Lưu ý quan trọng

1. **Tag phải có prefix `v`** — code dùng `data.tag_name.replace(/^v/, "")` để lấy version number
2. **Release phải là "latest"** — API endpoint dùng `/releases/latest`, không phải `/releases/tags/...`
3. **Không dùng pre-release flag** cho release chính — GitHub API `/releases/latest` bỏ qua pre-releases
4. **Brew tap** — nếu muốn support brew update, cần tạo repo `leduyphuc1702/homebrew-tap` riêng với formula
5. **Curl install** — hiện vẫn trỏ `opencode.ai/install` (của upstream). Nếu cần, tạo `install.sh` ở root repo và dùng raw GitHub URL

## Quick release (không build binary)

Nếu chỉ cần release để test version check (không cần binary download):

```bash
gh release create v<VERSION> \
  --repo leduyphuc1702/opencode-workflow \
  --title "v<VERSION>" \
  --notes "Release v<VERSION>" \
  --target dev
```

CLI sẽ detect version mới nhưng upgrade sẽ fail nếu không có binary. Đủ để test "update available" notification.

## CI Workflow

File `.github/workflows/publish.yml` có guard `if: github.repository == 'anomalyco/opencode'` — cần đổi thành `leduyphuc1702/opencode-workflow` nếu muốn CI tự động publish.
