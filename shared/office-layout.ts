import type { OfficeCapacity } from './team.js';
export const OFFICE_DESKS: [number, number, number][] = [
  [-4.3, 0, -2.4],
  [3.6, 0, -2.4],
  [-4.3, 0, 2.7],
  [3.6, 0, 2.7],
  [-11.9, 0, -2.4],
  [11.2, 0, -2.4],
  [-11.9, 0, 2.7],
  [11.2, 0, 2.7],
  [-11.9, 0, -7.5],
  [11.2, 0, -7.5],
  [-11.9, 0, 7.8],
  [11.2, 0, 7.8],
];
export function officeLayout(capacity: OfficeCapacity = 4) {
  const large = capacity === 12;
  return {
    capacity,
    width: capacity === 4 ? 17.7 : 32.5,
    depth: large ? 25 : 13.5,
    centerX: capacity === 4 ? 0 : -0.35,
    centerZ: large ? 0.5 : 0,
    minX: capacity === 4 ? -7.95 : -15.7,
    maxX: capacity === 4 ? 7.95 : 15,
    minZ: large ? -10.95 : -5.85,
    maxZ: large ? 12.1 : 6,
    backZ: large ? -11.65 : -6.55,
    tableZ: large ? 4.5 : 2.65,
    tableHalfZ: large ? 2.65 : 0.9,
    roomHalfZ: large ? 3.8 : 1.95,
    roomZ: large ? 4.5 : 2.65,
  };
}
export function meetingSeats(capacity: OfficeCapacity = 4) {
  const bottom = capacity === 12 ? 7.75 : 4.05;
  const seats = [
    { x: -0.55, z: 1.3, facing: 0 },
    { x: 0.55, z: 1.3, facing: 0 },
    { x: -0.55, z: bottom, facing: Math.PI },
    { x: 0.55, z: bottom, facing: Math.PI },
  ];
  const sideRows = capacity === 12 ? [2.2, 3.6, 5, 6.4] : capacity === 8 ? [2.1, 3.25] : [];
  for (const z of sideRows)
    seats.push({ x: -1.3, z, facing: Math.PI / 2 }, { x: 1.3, z, facing: -Math.PI / 2 });
  return seats;
}
