{
  fetchPnpmDeps,
  lib,
  makeWrapper,
  nodejs_24,
  pnpm_10,
  pnpmConfigHook,
  stdenv,
}:

let
  nodejs = nodejs_24;
  pnpm = pnpm_10;
in
stdenv.mkDerivation (finalAttrs: {
  pname = "huddlewire";
  version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
  src = ./.;
  strictDeps = true;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-iMlTlnMuHNmeWXOEhqjGbEnHSKcEkRjAN/XLFUhUttk=";
  };

  nativeBuildInputs = [
    makeWrapper
    nodejs
    pnpm
    pnpmConfigHook
  ];

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    app="$out/libexec/huddlewire"
    mkdir -p "$app" "$out/bin"
    cp package.json pnpm-lock.yaml "$app"
    cp -r dist "$app"
    pnpm --dir "$app" install --prod --offline --frozen-lockfile
    rm "$app/pnpm-lock.yaml"

    makeWrapper ${lib.getExe nodejs} "$out/bin/huddlewire" \
      --add-flags "$app/dist/main.js"

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    "$out/bin/huddlewire" --help >/dev/null
    runHook postInstallCheck
  '';

  meta = {
    description = "Desktop control plane for Slack Huddles";
    license = lib.licenses.mit;
    mainProgram = "huddlewire";
    platforms = lib.platforms.linux;
  };
})
