import { PlatformIdentifier, PlatformName } from 'homebridge';

export type OctoprintPlatformConfig = {
  platform: PlatformName | PlatformIdentifier;
  name?: string;
  instances?: Array<InstanceConfig>;
};

export type InstanceConfig = {
  name?: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  url?: string;
  api_key?: string;
  case_light?: boolean;
  occupancy_sensor?: boolean;
};