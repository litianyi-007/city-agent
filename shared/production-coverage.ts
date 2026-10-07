import type { ProductionCapability } from './production-schema.js';

export const PRODUCTION_COVERAGE_VERSION = 'production-coverage-owners-v1' as const;

/** Responsibilities, not success evidence. No model-controlled pass flags. */
export function productionCoverageContract(capability: ProductionCapability) {
  return {
    version: PRODUCTION_COVERAGE_VERSION,
    capability,
    owners: capability === 'camera-scene-v1' ? {
      hostSchema: { required: true, scope: 'Strict non-executable fields, primitive/range/count bounds, distinct palm/fist actions. Schema does NOT prove design or business mapping.' },
      roleCss: { required: true, scope: 'Independent frozen business state, precise rotation/reset and required concrete totals/title. Assert every explicit mapping at #gesture-map; mandatory Gate alone proves only self-consistency. No disabled camera clicks, unresolved values or count-change assertions.' },
      platformMandatoryGate: { required: true, scope: 'Per-run real Canvas/pixels/particle snapshots; scatter/gather/rotation/reset; synthetic 21 points, three-frame debounce and configured palm-X. Must execute AND pass alongside role CSS; not real vision/camera proof.' },
      platformEngineering: { required: false, scope: 'Separate versioned media start/stop, late permission, model/worker failure, release and asset regression. Not executed by per-run Gate or a role-declared pass.' },
      physicalAcceptance: { required: false, scope: 'User-initiated real camera/hand, lighting/latency, permission/error/stop and subjective scene quality; unverified; full requirement stays false until independent real-device evidence.' },
    } : {
      hostSchema: { required: true, scope: 'Complete inline HTML and strict test/verifier schemas; not business correctness.' },
      roleCss: { required: true, scope: 'All in-scope business behavior independently frozen and actually executed in restricted Chromium, including exact numeric results and edge cases. No platform template is evidence for generated code.' },
      platformMandatoryGate: { required: true, scope: 'Restricted browser network/navigation/error/timeout policies; no host execution or arbitrary repository support.' },
    },
    evidenceRule: 'This contract assigns obligations only. A claimed owner or engineering fixture does not pass a business requirement. Final delivery requires actual immutable checks; unknown and deferred coverage never become true automatically.',
  };
}
