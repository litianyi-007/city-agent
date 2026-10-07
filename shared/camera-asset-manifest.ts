/** Trusted, reviewed dependency pins; a downloaded manifest cannot redefine these. */
export const CAMERA_ASSET_PROFILE = 'mediapipe-hand-v1';
export const CAMERA_ASSET_VERSION = '0.10.32';
export const CAMERA_SOURCE_COMMIT = '8317ba78778738ba90a521e7e4580a2ba0129c81';
export const CAMERA_NPM_SOURCE = {
  url: 'https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.32.tgz',
  bytes: 6_939_067,
  sha256: 'b362a2b56aafcce7857047c25dc8fd69612fd8e75018e264717d24290e7815c1',
  integrity: 'sha512-3tiAZnmKloYnRXYoO3dKltTUGnqeCwzC4lV03uY0vCsE+aveJTyEVQyZHOlQGQNsjK+gRHzkf9q08C99Qm2K0Q==',
} as const;

export type CameraAssetPin = { path: string; source: string; archivePath?: string; bytes: number; sha256: string; contentType: string; runtime: boolean };
export const CAMERA_ASSET_PINS: readonly CameraAssetPin[] = [
  { path: 'vision_bundle.mjs', source: CAMERA_NPM_SOURCE.url, archivePath: 'package/vision_bundle.mjs', bytes: 137_160, sha256: 'de83c48ff329717a27aeb528d5ef5f47f077c628a5302dc483aca5b513e7464b', contentType: 'text/javascript; charset=utf-8', runtime: true },
  { path: 'vision_wasm_internal.js', source: CAMERA_NPM_SOURCE.url, archivePath: 'package/wasm/vision_wasm_internal.js', bytes: 204_816, sha256: '6f6b86509cf9e163ea1cfec7edc8cf53732699c04781e4c21c557c1ba402310e', contentType: 'text/javascript; charset=utf-8', runtime: true },
  { path: 'vision_wasm_internal.wasm', source: CAMERA_NPM_SOURCE.url, archivePath: 'package/wasm/vision_wasm_internal.wasm', bytes: 11_453_626, sha256: 'cb3ec20026a9aecc2a81a93c25630ceb5389297ddb7a5f0bd61dd09cde606b9b', contentType: 'application/wasm', runtime: true },
  { path: 'vision_wasm_nosimd_internal.js', source: CAMERA_NPM_SOURCE.url, archivePath: 'package/wasm/vision_wasm_nosimd_internal.js', bytes: 204_669, sha256: '9f8fc960e363f0fb2f42f7937b97ae9cf9a5630490f71031fa90caa9bb121938', contentType: 'text/javascript; charset=utf-8', runtime: true },
  { path: 'vision_wasm_nosimd_internal.wasm', source: CAMERA_NPM_SOURCE.url, archivePath: 'package/wasm/vision_wasm_nosimd_internal.wasm', bytes: 10_647_962, sha256: '924274fcd5ac8985f6570a8573e7971b7bd2d580ba1b8f3beb0ba8f95db6347c', contentType: 'application/wasm', runtime: true },
  { path: 'hand_landmarker.task', source: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', bytes: 7_819_105, sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1', contentType: 'application/octet-stream', runtime: true },
  { path: 'PACKAGE.json', source: CAMERA_NPM_SOURCE.url, archivePath: 'package/package.json', bytes: 592, sha256: '7e2b35c27840238235ae47abad63b5875fb1f8bf013ff4101a3595acea6f8682', contentType: 'application/json', runtime: false },
  { path: 'MEDIAPIPE-README.md', source: CAMERA_NPM_SOURCE.url, archivePath: 'package/README.md', bytes: 8_403, sha256: 'aadce68d35bfc0dc75fd191bbf9e6285816e907eb43a6301b43bd9a29768f7c5', contentType: 'text/plain; charset=utf-8', runtime: false },
  { path: 'LICENSE', source: `https://raw.githubusercontent.com/google-ai-edge/mediapipe/${CAMERA_SOURCE_COMMIT}/LICENSE`, bytes: 12_331, sha256: '8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8', contentType: 'text/plain; charset=utf-8', runtime: false },
  { path: 'MODEL-CARD.pdf', source: 'https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf', bytes: 358_044, sha256: '43127ff8a92e22717f0d8c30dab3efef4641a29cbf50b15ae3de001be94ab76b', contentType: 'application/pdf', runtime: false },
] as const;

/** Runtime-serving allowlist. Notices are retained locally, not implicit routes. */
export const CAMERA_ASSET_MANIFEST = {
  version: CAMERA_ASSET_PROFILE, packageVersion: CAMERA_ASSET_VERSION, sourceCommit: CAMERA_SOURCE_COMMIT,
  assets: CAMERA_ASSET_PINS.filter(pin => pin.runtime).map(pin => ({ filename: pin.path, sha256: pin.sha256, bytes: pin.bytes, contentType: pin.contentType, sourceUrl: pin.source })),
} as const;

export const CAMERA_ASSET_NOTICE = `City Agent controlled camera dependency notice
Profile: ${CAMERA_ASSET_PROFILE}
Reviewed dependency: @mediapipe/tasks-vision ${CAMERA_ASSET_VERSION}
Copyright 2022 The MediaPipe Authors. Licensed under Apache License 2.0.
Official source release tag v${CAMERA_ASSET_VERSION}: ${CAMERA_SOURCE_COMMIT}
The npm archive contains no gitHead; this release-source association is not
proof that the published binaries can be rebuilt byte-for-byte from that commit.
The JS and WASM files are preserved without modifications. Only paths are
flattened when extracted from the npm archive. LICENSE is preserved in full,
including its additional file-specific licensing notice.
Hand Landmarker bundle: hand_landmarker/float16/1, fixed by SHA256.
The official task overview links the October 2021 Hand Tracking model card,
which states Apache License 2.0 and documents experimental-use limitations.
Its date is not the publication date of the current .task bundle.
No camera images, private video, credentials or generated code are included.
The current upstream privacy notice says input processing is on-device, but
Tasks APIs can send performance/utilization metrics. A static string inspection
does not prove absence of telemetry. Runtime egress must be tested separately.
See manifest.json and docs/production/CAMERA-ASSETS.md for pins and boundaries.
`;
