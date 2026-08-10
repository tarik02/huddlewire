{
  description = "Desktop control plane for Slack Huddles";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      packages.${system} = rec {
        huddlewire = pkgs.callPackage ./package.nix { };
        default = huddlewire;
      };

      apps.${system}.default = {
        type = "app";
        program = "${pkgs.lib.getExe self.packages.${system}.default}";
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.nodejs_24
          pkgs.pnpm_10
        ];
      };

      formatter.${system} = pkgs.nixfmt;
    };
}
