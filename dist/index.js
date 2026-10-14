'use strict';
const { ReolinkPrivacyPlatform } = require('./platform');
module.exports = (api) => {
  api.registerPlatform('HomebridgeReolinkPrivacy', 'ReolinkPrivacy', ReolinkPrivacyPlatform);
};
