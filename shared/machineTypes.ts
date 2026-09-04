// Machine type definitions for the slot-machine rewards section (shared with client)
// NOTE: No server-side /api/machines endpoints exist yet; this module provides the
// client-side type catalogue only so the Rewards page compiles without errors.
export interface MachineType {
  id: string;
  name: string;
  imageUrl: string;
  imagePosition?: string;
  imageZoom?: number;
  hourlyAxn: number;
  priceAxn: number;
}

// Catalogue can be extended later when the machine purchase endpoints are built.
export const MACHINE_TYPES: MachineType[] = [];
