# Changelog

## [0.1.12](https://github.com/nozomiishii/git-harvest/compare/v0.1.11...v0.1.12) (2026-04-03)


### Features

* add auto-update check and --update self-update command ([#34](https://github.com/nozomiishii/git-harvest/issues/34)) ([b457362](https://github.com/nozomiishii/git-harvest/commit/b45736208a1ea009a0b449bcc64a929946277e4e))
* add bunfig.toml with minimumReleaseAge for supply chain protection ([#52](https://github.com/nozomiishii/git-harvest/issues/52)) ([f778993](https://github.com/nozomiishii/git-harvest/commit/f778993ca4f0f000cb16e69fe8395ea01bfd62df))
* add curl-based install and uninstall scripts ([db290d6](https://github.com/nozomiishii/git-harvest/commit/db290d6b511d52b0de90303bf9c419e709033a77))
* add harvest summary display, dry-run mode, and terminal animations ([#31](https://github.com/nozomiishii/git-harvest/issues/31)) ([6b200e4](https://github.com/nozomiishii/git-harvest/commit/6b200e41c89c6a3187e35b6acaa0572ba3f8e7d6))
* add Homebrew publishing support ([#22](https://github.com/nozomiishii/git-harvest/issues/22)) ([65deeb0](https://github.com/nozomiishii/git-harvest/commit/65deeb05db1d53f666c512d371acd4f606864662))
* adopt draft-then-publish pattern for release immutability ([#56](https://github.com/nozomiishii/git-harvest/issues/56)) ([31a4b02](https://github.com/nozomiishii/git-harvest/commit/31a4b02e695a9290c3a8431b5a17a4f1695639bc))
* show alias setup hints after install completes ([#18](https://github.com/nozomiishii/git-harvest/issues/18)) ([1ff7809](https://github.com/nozomiishii/git-harvest/commit/1ff7809131f1bdde4fd76b13fc3c69cd6d0837da))
* show status for all worktrees and branches with [GROWING]/[DELETED] labels ([#44](https://github.com/nozomiishii/git-harvest/issues/44)) ([3dbc939](https://github.com/nozomiishii/git-harvest/commit/3dbc9393f58307b82198edd6e395121ba2111b41))
* use GitHub App token for release-please to trigger CI on PRs ([#55](https://github.com/nozomiishii/git-harvest/issues/55)) ([826e1f0](https://github.com/nozomiishii/git-harvest/commit/826e1f03aaf6790bc8fab6f52f6b39068aa79f43))


### Bug Fixes

* add issues write permission to release-please workflow ([#35](https://github.com/nozomiishii/git-harvest/issues/35)) ([4b6244f](https://github.com/nozomiishii/git-harvest/commit/4b6244fda5f6d139972a09553019f422c2be7c6a))
* add push-to parameter to skip fork creation ([#27](https://github.com/nozomiishii/git-harvest/issues/27)) ([d9bcf6a](https://github.com/nozomiishii/git-harvest/commit/d9bcf6ae5cc56a844924e506612570f9a8adec50))
* align branch output indentation with worktree section ([#39](https://github.com/nozomiishii/git-harvest/issues/39)) ([c876b79](https://github.com/nozomiishii/git-harvest/commit/c876b79405a2e818a3eed2187774c1394d94e53e))
* disable pull request creation in homebrew formula update ([#25](https://github.com/nozomiishii/git-harvest/issues/25)) ([bce727e](https://github.com/nozomiishii/git-harvest/commit/bce727ec547b335df6e730b8498aac9a72b273a0))
* harden worktree and branch deletion safety checks ([#42](https://github.com/nozomiishii/git-harvest/issues/42)) ([a4e8def](https://github.com/nozomiishii/git-harvest/commit/a4e8defbdd6dfd614f6c48eb4ef857dde121f2d7))
* move restart instruction to end of install message ([#46](https://github.com/nozomiishii/git-harvest/issues/46)) ([ef09241](https://github.com/nozomiishii/git-harvest/commit/ef09241f88d65447d8e7152cde267bf492e87202))
* remove duplicate entries from CHANGELOG ([#17](https://github.com/nozomiishii/git-harvest/issues/17)) ([d77d1f3](https://github.com/nozomiishii/git-harvest/commit/d77d1f38493845237945510718f1e616ba6de5d3))
* skip branches with no unique commits in merge detection ([#41](https://github.com/nozomiishii/git-harvest/issues/41)) ([5f47d11](https://github.com/nozomiishii/git-harvest/commit/5f47d11f220747e2c6cbe0a288e6da6d94be5f2f))
* update bootstrap-sha after history linearization ([#15](https://github.com/nozomiishii/git-harvest/issues/15)) ([5a61aae](https://github.com/nozomiishii/git-harvest/commit/5a61aae0c7026358e9cb0ff4331fe4843f84a82e))

## [0.1.11](https://github.com/nozomiishii/git-harvest/compare/v0.1.10...v0.1.11) (2026-04-03)


### Features

* adopt draft-then-publish pattern for release immutability ([#56](https://github.com/nozomiishii/git-harvest/issues/56)) ([31a4b02](https://github.com/nozomiishii/git-harvest/commit/31a4b02e695a9290c3a8431b5a17a4f1695639bc))

## [0.1.10](https://github.com/nozomiishii/git-harvest/compare/v0.1.9...v0.1.10) (2026-04-02)


### Features

* add bunfig.toml with minimumReleaseAge for supply chain protection ([#52](https://github.com/nozomiishii/git-harvest/issues/52)) ([f778993](https://github.com/nozomiishii/git-harvest/commit/f778993ca4f0f000cb16e69fe8395ea01bfd62df))
* show status for all worktrees and branches with [GROWING]/[DELETED] labels ([#44](https://github.com/nozomiishii/git-harvest/issues/44)) ([3dbc939](https://github.com/nozomiishii/git-harvest/commit/3dbc9393f58307b82198edd6e395121ba2111b41))
* use GitHub App token for release-please to trigger CI on PRs ([#55](https://github.com/nozomiishii/git-harvest/issues/55)) ([826e1f0](https://github.com/nozomiishii/git-harvest/commit/826e1f03aaf6790bc8fab6f52f6b39068aa79f43))


### Bug Fixes

* move restart instruction to end of install message ([#46](https://github.com/nozomiishii/git-harvest/issues/46)) ([ef09241](https://github.com/nozomiishii/git-harvest/commit/ef09241f88d65447d8e7152cde267bf492e87202))

## [0.1.9](https://github.com/nozomiishii/git-harvest/compare/v0.1.8...v0.1.9) (2026-03-30)


### Features

* add auto-update check and --update self-update command ([#34](https://github.com/nozomiishii/git-harvest/issues/34)) ([b457362](https://github.com/nozomiishii/git-harvest/commit/b45736208a1ea009a0b449bcc64a929946277e4e))


### Bug Fixes

* align branch output indentation with worktree section ([#39](https://github.com/nozomiishii/git-harvest/issues/39)) ([c876b79](https://github.com/nozomiishii/git-harvest/commit/c876b79405a2e818a3eed2187774c1394d94e53e))
* harden worktree and branch deletion safety checks ([#42](https://github.com/nozomiishii/git-harvest/issues/42)) ([a4e8def](https://github.com/nozomiishii/git-harvest/commit/a4e8defbdd6dfd614f6c48eb4ef857dde121f2d7))
* skip branches with no unique commits in merge detection ([#41](https://github.com/nozomiishii/git-harvest/issues/41)) ([5f47d11](https://github.com/nozomiishii/git-harvest/commit/5f47d11f220747e2c6cbe0a288e6da6d94be5f2f))

## [0.1.8](https://github.com/nozomiishii/git-harvest/compare/v0.1.7...v0.1.8) (2026-03-30)


### Features

* add harvest summary display, dry-run mode, and terminal animations ([#31](https://github.com/nozomiishii/git-harvest/issues/31)) ([6b200e4](https://github.com/nozomiishii/git-harvest/commit/6b200e41c89c6a3187e35b6acaa0572ba3f8e7d6))


### Bug Fixes

* add issues write permission to release-please workflow ([#35](https://github.com/nozomiishii/git-harvest/issues/35)) ([4b6244f](https://github.com/nozomiishii/git-harvest/commit/4b6244fda5f6d139972a09553019f422c2be7c6a))

## [0.1.7](https://github.com/nozomiishii/git-harvest/compare/v0.1.6...v0.1.7) (2026-03-28)


### Bug Fixes

* add push-to parameter to skip fork creation ([#27](https://github.com/nozomiishii/git-harvest/issues/27)) ([d9bcf6a](https://github.com/nozomiishii/git-harvest/commit/d9bcf6ae5cc56a844924e506612570f9a8adec50))

## [0.1.6](https://github.com/nozomiishii/git-harvest/compare/v0.1.5...v0.1.6) (2026-03-28)


### Bug Fixes

* disable pull request creation in homebrew formula update ([#25](https://github.com/nozomiishii/git-harvest/issues/25)) ([bce727e](https://github.com/nozomiishii/git-harvest/commit/bce727ec547b335df6e730b8498aac9a72b273a0))

## [0.1.5](https://github.com/nozomiishii/git-harvest/compare/v0.1.4...v0.1.5) (2026-03-28)


### Features

* add Homebrew publishing support ([#22](https://github.com/nozomiishii/git-harvest/issues/22)) ([65deeb0](https://github.com/nozomiishii/git-harvest/commit/65deeb05db1d53f666c512d371acd4f606864662))

## [0.1.4](https://github.com/nozomiishii/git-harvest/compare/v0.1.3...v0.1.4) (2026-03-27)


### Features

* show alias setup hints after install completes ([#18](https://github.com/nozomiishii/git-harvest/issues/18)) ([1ff7809](https://github.com/nozomiishii/git-harvest/commit/1ff7809131f1bdde4fd76b13fc3c69cd6d0837da))

## [0.1.3](https://github.com/nozomiishii/git-harvest/compare/v0.1.2...v0.1.3) (2026-03-27)


### Features

* add curl-based install and uninstall scripts ([db290d6](https://github.com/nozomiishii/git-harvest/commit/db290d6b511d52b0de90303bf9c419e709033a77))


### Bug Fixes

* remove duplicate entries from CHANGELOG ([#17](https://github.com/nozomiishii/git-harvest/issues/17)) ([d77d1f3](https://github.com/nozomiishii/git-harvest/commit/d77d1f38493845237945510718f1e616ba6de5d3))
* update bootstrap-sha after history linearization ([#15](https://github.com/nozomiishii/git-harvest/issues/15)) ([5a61aae](https://github.com/nozomiishii/git-harvest/commit/5a61aae0c7026358e9cb0ff4331fe4843f84a82e))

## [0.1.2](https://github.com/nozomiishii/git-harvest/compare/v0.1.1...v0.1.2) (2026-03-26)


### Bug Fixes

* remove .sh extension from bin entry and add files field ([476654b](https://github.com/nozomiishii/git-harvest/commit/476654bfe51d875273600887a373b9cac4efc16b))

## [0.1.1](https://github.com/nozomiishii/git-harvest/compare/v0.1.0...v0.1.1) (2026-03-26)


### Bug Fixes

* use explicit default branch in test setup for CI compatibility ([c44f447](https://github.com/nozomiishii/git-harvest/commit/c44f447f3c6ff5dd6d8183c3328fe9d65e7c45f6))
