#!/bin/bash
set -e
PKG_NAME="luci-app-taskman"
VERSION="1.0.0-1"
WORK_DIR="/tmp/ipk_build_taskman"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/CONTROL" "$WORK_DIR/etc" "$WORK_DIR/usr" "$WORK_DIR/www"

# Copy root and htdocs
cp -a root/* "$WORK_DIR/"
cp -a htdocs/* "$WORK_DIR/www/"

# Control file
cat << EOF > "$WORK_DIR/CONTROL/control"
Package: $PKG_NAME
Version: $VERSION
Depends: luci-base, rpcd-mod-ucode
Section: luci
Architecture: all
Maintainer: OpenWrt LuCI Team
Description: LuCI support for Task Manager (Hardware & Process Monitor)
EOF

cat << 'EOF' > "$WORK_DIR/CONTROL/postinst"
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	/etc/init.d/rpcd restart
	rm -f /tmp/luci-indexcache*
}
exit 0
EOF
chmod 755 "$WORK_DIR/CONTROL/postinst"

cat << 'EOF' > "$WORK_DIR/CONTROL/postrm"
#!/bin/sh
rm -f /tmp/luci-indexcache*
exit 0
EOF
chmod 755 "$WORK_DIR/CONTROL/postrm"

echo "2.0" > "$WORK_DIR/debian-binary"
tar --numeric-owner --group=0 --owner=0 -czf "$WORK_DIR/data.tar.gz" -C "$WORK_DIR" etc usr www
tar --numeric-owner --group=0 --owner=0 -czf "$WORK_DIR/control.tar.gz" -C "$WORK_DIR/CONTROL" .

tar --numeric-owner --group=0 --owner=0 -czf "${PKG_NAME}_${VERSION}_all.ipk" -C "$WORK_DIR" debian-binary data.tar.gz control.tar.gz
echo "Built: ${PKG_NAME}_${VERSION}_all.ipk"
