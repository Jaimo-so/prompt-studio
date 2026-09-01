#!/bin/zsh
set -euo pipefail

SCRIPT_DIRECTORY="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIRECTORY:h}"
APP_NAME="Prompt Studio"
RELEASE_DIRECTORY="$PROJECT_ROOT/release"
APP_DIRECTORY="$RELEASE_DIRECTORY/$APP_NAME.app"
CONTENTS_DIRECTORY="$APP_DIRECTORY/Contents"
MACOS_DIRECTORY="$CONTENTS_DIRECTORY/MacOS"
RESOURCES_DIRECTORY="$CONTENTS_DIRECTORY/Resources"
TEMP_DIRECTORY="$(mktemp -d)"

trap 'rm -rf "$TEMP_DIRECTORY"' EXIT

cd "$PROJECT_ROOT"
npm run build

rm -rf "$APP_DIRECTORY"
mkdir -p "$MACOS_DIRECTORY" "$RESOURCES_DIRECTORY"

/usr/bin/clang -O2 -fobjc-arc -framework Cocoa -framework UniformTypeIdentifiers -framework WebKit \
  "$PROJECT_ROOT/packaging/macos/PromptStudioApp.m" \
  -o "$MACOS_DIRECTORY/PromptStudio"

/usr/bin/clang -O2 -fobjc-arc -framework AppKit \
  "$PROJECT_ROOT/packaging/macos/AppIconGenerator.m" \
  -o "$TEMP_DIRECTORY/AppIconGenerator"

"$TEMP_DIRECTORY/AppIconGenerator" "$RESOURCES_DIRECTORY/AppIcon.icns"

cp "$PROJECT_ROOT/packaging/macos/Info.plist" "$CONTENTS_DIRECTORY/Info.plist"
/usr/bin/plutil -replace WorkbenchDataRoot -string "$PROJECT_ROOT" "$CONTENTS_DIRECTORY/Info.plist"
NODE_REAL_PATH="${$(command -v node):A}"
NODE_PREFIX="${NODE_REAL_PATH:h:h}"
LIBNODE_SOURCES=("$NODE_PREFIX"/lib/libnode*.dylib)
LIBNODE_SOURCE="$LIBNODE_SOURCES[1]"
LIBNODE_NAME="${LIBNODE_SOURCE:t}"

cp "$NODE_REAL_PATH" "$RESOURCES_DIRECTORY/node"
cp "$LIBNODE_SOURCE" "$RESOURCES_DIRECTORY/$LIBNODE_NAME"
/usr/bin/codesign --remove-signature "$RESOURCES_DIRECTORY/node" 2>/dev/null || true
/usr/bin/codesign --remove-signature "$RESOURCES_DIRECTORY/$LIBNODE_NAME" 2>/dev/null || true
/usr/bin/install_name_tool -change "@rpath/$LIBNODE_NAME" "@loader_path/$LIBNODE_NAME" "$RESOURCES_DIRECTORY/node"

typeset -a RUNTIME_BINARIES
RUNTIME_BINARIES=("$RESOURCES_DIRECTORY/node" "$RESOURCES_DIRECTORY/$LIBNODE_NAME")
RUNTIME_INDEX=1
while (( RUNTIME_INDEX <= ${#RUNTIME_BINARIES[@]} )); do
  CURRENT_BINARY="$RUNTIME_BINARIES[$RUNTIME_INDEX]"
  if [[ "$CURRENT_BINARY" == *.dylib ]]; then
    /usr/bin/install_name_tool -id "@loader_path/${CURRENT_BINARY:t}" "$CURRENT_BINARY"
  fi

  HOMEBREW_DEPENDENCIES=("${(@f)$(otool -L "$CURRENT_BINARY" | tail -n +2 | awk '{print $1}' | grep '^/opt/homebrew/' || true)}")
  for DEPENDENCY in "$HOMEBREW_DEPENDENCIES[@]"; do
    [[ -n "$DEPENDENCY" ]] || continue
    DEPENDENCY_NAME="${DEPENDENCY:t}"
    DEPENDENCY_DESTINATION="$RESOURCES_DIRECTORY/$DEPENDENCY_NAME"
    if [[ ! -f "$DEPENDENCY_DESTINATION" ]]; then
      cp -L "$DEPENDENCY" "$DEPENDENCY_DESTINATION"
      /usr/bin/codesign --remove-signature "$DEPENDENCY_DESTINATION" 2>/dev/null || true
      RUNTIME_BINARIES+=("$DEPENDENCY_DESTINATION")
    fi
    /usr/bin/install_name_tool -change "$DEPENDENCY" "@loader_path/$DEPENDENCY_NAME" "$CURRENT_BINARY"
  done

  LOADER_DEPENDENCIES=("${(@f)$(otool -L "$CURRENT_BINARY" | tail -n +2 | awk '{print $1}' | grep '^@loader_path/' || true)}")
  for DEPENDENCY in "$LOADER_DEPENDENCIES[@]"; do
    [[ -n "$DEPENDENCY" ]] || continue
    DEPENDENCY_NAME="${DEPENDENCY:t}"
    DEPENDENCY_DESTINATION="$RESOURCES_DIRECTORY/$DEPENDENCY_NAME"
    if [[ ! -f "$DEPENDENCY_DESTINATION" ]]; then
      DEPENDENCY_SOURCES=(/opt/homebrew/opt/*/lib/"$DEPENDENCY_NAME"(N))
      if (( ${#DEPENDENCY_SOURCES[@]} == 0 )); then
        echo "无法定位运行库：$DEPENDENCY_NAME" >&2
        exit 1
      fi
      cp -L "$DEPENDENCY_SOURCES[1]" "$DEPENDENCY_DESTINATION"
      /usr/bin/codesign --remove-signature "$DEPENDENCY_DESTINATION" 2>/dev/null || true
      RUNTIME_BINARIES+=("$DEPENDENCY_DESTINATION")
    fi
  done

  RPATH_DEPENDENCIES=("${(@f)$(otool -L "$CURRENT_BINARY" | tail -n +2 | awk '{print $1}' | grep '^@rpath/' || true)}")
  for DEPENDENCY in "$RPATH_DEPENDENCIES[@]"; do
    [[ -n "$DEPENDENCY" ]] || continue
    DEPENDENCY_NAME="${DEPENDENCY:t}"
    DEPENDENCY_DESTINATION="$RESOURCES_DIRECTORY/$DEPENDENCY_NAME"
    if [[ ! -f "$DEPENDENCY_DESTINATION" ]]; then
      DEPENDENCY_SOURCES=(/opt/homebrew/opt/*/lib/"$DEPENDENCY_NAME"(N))
      if (( ${#DEPENDENCY_SOURCES[@]} == 0 )); then
        echo "无法定位运行库：$DEPENDENCY_NAME" >&2
        exit 1
      fi
      cp -L "$DEPENDENCY_SOURCES[1]" "$DEPENDENCY_DESTINATION"
      /usr/bin/codesign --remove-signature "$DEPENDENCY_DESTINATION" 2>/dev/null || true
      RUNTIME_BINARIES+=("$DEPENDENCY_DESTINATION")
    fi
    /usr/bin/install_name_tool -change "$DEPENDENCY" "@loader_path/$DEPENDENCY_NAME" "$CURRENT_BINARY"
  done
  (( RUNTIME_INDEX += 1 ))
done

cp "$PROJECT_ROOT/server.mjs" "$RESOURCES_DIRECTORY/server.mjs"
cp -R "$PROJECT_ROOT/dist" "$RESOURCES_DIRECTORY/dist"

chmod 755 "$MACOS_DIRECTORY/PromptStudio" "$RESOURCES_DIRECTORY/node"
for RUNTIME_BINARY in "$RUNTIME_BINARIES[@]"; do
  /usr/bin/codesign --force --sign - "$RUNTIME_BINARY"
done
/usr/bin/codesign --force --deep --sign - "$APP_DIRECTORY"

echo "$APP_DIRECTORY"
