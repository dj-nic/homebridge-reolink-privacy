import type { API } from 'homebridge';
import { ReolinkPrivacyPlatform } from './platform';

export = (api: API): void => {
  api.registerPlatform('HomebridgeReolinkPrivacy', 'ReolinkPrivacy', ReolinkPrivacyPlatform);
};
