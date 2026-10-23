import { DESKS, type Person } from './simulation';

export const DESK_CHAIR = { z: 1.1, seatTop: 0.77 };
export const TORSO_BOTTOM = 0.74;

/** Navigation stops behind the chair. The rendered body moves onto its seat
 * only after arrival, keeping walking routes outside furniture footprints. */
export function seatedPose(person: Person, desk: number) {
  if (person.path.length || Math.hypot(person.x - person.goal.x, person.z - person.goal.z) > 0.12)
    return undefined;
  if (person.goal.action === 'desk')
    return {
      x: DESKS[desk][0] - person.x,
      z: DESKS[desk][2] + DESK_CHAIR.z - person.z,
      y: DESK_CHAIR.seatTop - TORSO_BOTTOM,
      facing: Math.PI,
      shinScale: 1.85,
    };
  if (person.goal.action === 'meeting')
    return { x: 0, z: 0, y: 0.625 - TORSO_BOTTOM, facing: person.goal.facing, shinScale: 1.45 };
  return undefined;
}
