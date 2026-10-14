{
  alsa-lib,
  buildGoModule,
  lib,
  pkg-config,
  stdenv,
}:

buildGoModule (finalAttrs: {
  pname = "huddlewire";
  version = "0.2.0";

  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./go.mod
      ./go.sum
      ./main.go
      ./internal
    ];
  };

  vendorHash = "sha256-9FNgXUbAWb82NcHDvz7ZfnmwDA66vq73scxmcxw2SUw=";

  # Linux plays sounds through ALSA; macOS uses system frameworks.
  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ pkg-config ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ alsa-lib ];

  ldflags = [
    "-s"
    "-w"
    "-X github.com/tarik02/huddlewire/internal/config.Version=${finalAttrs.version}"
  ];

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
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
})
