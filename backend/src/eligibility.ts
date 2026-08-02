import type { AgentCapabilitiesV1, JobRequestV1 } from './types.js';

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export function evaluateEligibility(request: JobRequestV1, capabilities: AgentCapabilitiesV1): EligibilityResult {
  const reasons: string[] = [];
  if (!capabilities.protocol_versions.includes('affetta.job.v1') ||
      !capabilities.protocol_versions.includes('affetta.result.v1')) {
    reasons.push('protocol_version_unsupported');
  }

  const requestedOutput = request.print_intent.requested_output_format ?? 'gcode';
  if (!capabilities.output_formats.includes(requestedOutput)) {
    reasons.push('output_format_unsupported');
  }

  if (request.routing.preferred_engine) {
    const engine = capabilities.engines.find((item) => item.id === request.routing.preferred_engine);
    if (!engine?.available) reasons.push('preferred_engine_unavailable');
  }

  const profiles = capabilities.printer_profiles.filter((profile) => {
    if (profile.profile_status === 'deprecated') return false;
    if (profile.output_format !== requestedOutput) return false;
    if (!profile.materials.includes(request.print_intent.material_id)) return false;
    if (request.print_intent.nozzle_mm !== undefined &&
        !profile.nozzles_mm.some((value) => Math.abs(value - request.print_intent.nozzle_mm!) < 0.0001)) return false;
    if (request.routing.require_production_ready && !profile.production_ready) return false;
    if (request.routing.printer_profile_id && profile.profile_id !== request.routing.printer_profile_id) return false;
    if (request.routing.fleet_unit_id && profile.fleet_unit_id !== request.routing.fleet_unit_id) return false;
    return true;
  });

  if (profiles.length === 0) reasons.push('no_compatible_profile');

  if (requestedOutput === 'x3g') {
    const gpx = capabilities.postprocessors.find((item) => item.id === 'gpx');
    if (!gpx?.available) reasons.push('gpx_unavailable');
  }

  return { eligible: reasons.length === 0, reasons };
}
