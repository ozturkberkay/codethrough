# Homebrew formula for the `codethrough` CLI.
#
# `codethrough` ships as a single, self-contained compiled binary.
# `git` is the ONLY runtime dependency.
#
# RELEASE PIPELINE: the `url` and `sha256` values below are PLACEHOLDERS. The
# release pipeline (.github/workflows/cli_release.yml builds the binary; the
# formula-publish step) fills in the real download URL and checksum for each
# tagged release. Until a real release exists they are intentionally invalid.
class Codethrough < Formula
  desc "Guided, GitHub-connected PR review you run on your own machine"
  homepage "https://github.com/ozturkberkay/codethrough"
  version "0.0.0"
  license "Apache-2.0"

  depends_on "git"

  # Prebuilt binary. macOS (Apple Silicon) is the only supported target today.
  on_macos do
    on_arm do
      url "https://github.com/ozturkberkay/codethrough/releases/download/v0.0.0/codethrough-macos-arm64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
  end

  def install
    bin.install Dir["codethrough*"].first => "codethrough"
  end

  test do
    assert_match "codethrough", shell_output("#{bin}/codethrough --help")
    system bin/"codethrough", "auth", "status"
  end
end
