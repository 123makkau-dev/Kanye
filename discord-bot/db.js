const mongoose = require('mongoose');

// ─── Schemas ──────────────────────────────────────────────────────────────────
const accountSchema = new mongoose.Schema({
  username:       { type: String, required: true, unique: true, lowercase: true },
  channelId:      { type: String, required: true },
  guildId:        { type: String, default: null },
  followers:      { type: Number, default: 0 },
  lastStatus:     { type: String, enum: ['active', 'banned'], default: 'active' },
  lastUsername:   { type: String, default: null },   // for username change detect
  isPrivate:      { type: Boolean, default: null },  // for private/public detect
  failCount:      { type: Number, default: 0 },
  paused:         { type: Boolean, default: false },
  startTime:      { type: Date, default: Date.now },
  lastChangeTime: { type: Date, default: null }
});

const statSchema = new mongoose.Schema({
  event:     { type: String, enum: ['banned', 'recovered', 'username_change', 'private', 'public', 'followers_change'] },
  username:  { type: String, lowercase: true },
  detail:    { type: String, default: '' },
  timestamp: { type: Date, default: Date.now }
});

const followerTrackSchema = new mongoose.Schema({
  username:    { type: String, required: true, unique: true, lowercase: true },
  channelId:   { type: String, required: true },
  guildId:     { type: String, default: null },
  followers:   { type: Number, default: 0 },
  threshold:   { type: Number, default: 0 },  // alert if change >= threshold
  paused:      { type: Boolean, default: false },
  startTime:   { type: Date, default: Date.now }
});

const dmUserSchema = new mongoose.Schema({
  userId:    { type: String, required: true, unique: true },
  enabled:   { type: Boolean, default: true }
});

const blacklistSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true }
});

const verifyTrackSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true, lowercase: true },
  channelId: { type: String, required: true },
  guildId:   { type: String, default: null },
  startTime: { type: Date, default: Date.now }
});

// Update channel — stores channel ID per guild for bot updates
const updateChannelSchema = new mongoose.Schema({
  guildId:   { type: String, required: true, unique: true },
  channelId: { type: String, required: true }
});

const configSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed }
});

// Guild access — which guilds are allowed to use the bot
const guildAccessSchema = new mongoose.Schema({
  guildId:   { type: String, required: true, unique: true },
  guildName: { type: String, default: '' },
  addedBy:   { type: String, default: '' },
  addedAt:   { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null }  // null = permanent
});

// Premium users — noprefix + DM notification
const premiumSchema = new mongoose.Schema({
  userId:    { type: String, required: true, unique: true },
  guildId:   { type: String, default: null },
  addedBy:   { type: String, default: '' },
  addedAt:   { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null }  // null = permanent
});

const Account        = mongoose.model('Account',        accountSchema);
const Stat           = mongoose.model('Stat',           statSchema);
const FollowerTrack  = mongoose.model('FollowerTrack',  followerTrackSchema);
const DmUser         = mongoose.model('DmUser',         dmUserSchema);
const Blacklist      = mongoose.model('Blacklist',      blacklistSchema);
const VerifyTrack    = mongoose.model('VerifyTrack',    verifyTrackSchema);
const Config         = mongoose.model('Config',         configSchema);
const GuildAccess    = mongoose.model('GuildAccess',    guildAccessSchema);
const Premium        = mongoose.model('Premium',        premiumSchema);
const UpdateChannel  = mongoose.model('UpdateChannel',  updateChannelSchema);

// ─── Connect ──────────────────────────────────────────────────────────────────
async function connect() {
  const uris = [process.env.MONGODB_URI, process.env.MONGODB_URI_BACKUP].filter(Boolean);
  for (const uri of uris) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      console.log(`[DB] Connected: ${uri.split('@')[1]?.split('/')[0]}`);
      return true;
    } catch (err) {
      console.warn(`[DB] Failed (${uri.split('@')[1]?.split('/')[0]}): ${err.message}`);
    }
  }
  console.error('[DB] All URIs failed!');
  return false;
}

module.exports = {
  connect,

  // ── Accounts ────────────────────────────────────────────────────────────────
  addAccount: async (username, channelId, status, followers, guildId) => {
    await Account.findOneAndUpdate(
      { username: username.toLowerCase() },
      { username: username.toLowerCase(), channelId, guildId: guildId || null, followers: followers ? parseInt(followers) : 0, lastStatus: status, failCount: 0, paused: false, startTime: new Date(), lastChangeTime: null },
      { upsert: true, new: true }
    );
  },

  getAccounts:       async () => Account.find({ failCount: { $lt: 5 } }),
  getBanWatchList:   async () => Account.find({ lastStatus: 'active',  failCount: { $lt: 5 } }),
  getUnbanWatchList: async () => Account.find({ lastStatus: 'banned',  failCount: { $lt: 5 } }),
  getAccount:        async (u) => Account.findOne({ username: u.toLowerCase() }),
  removeAccount:     async (u) => Account.deleteOne({ username: u.toLowerCase() }),

  updateStatus: async (u, status) => {
    await Account.findOneAndUpdate({ username: u.toLowerCase() }, { lastStatus: status, lastChangeTime: new Date(), failCount: 0 });
  },
  incrementFail: async (u) => Account.findOneAndUpdate({ username: u.toLowerCase() }, { $inc: { failCount: 1 } }),
  resetFail:     async (u) => Account.findOneAndUpdate({ username: u.toLowerCase() }, { failCount: 0 }),
  updateFollowers: async (u, f) => Account.findOneAndUpdate({ username: u.toLowerCase() }, { followers: parseInt(f) || 0 }),
  setPaused: async (u, paused) => Account.findOneAndUpdate({ username: u.toLowerCase() }, { paused }),
  updateLastUsername: async (u, lastUsername) => Account.findOneAndUpdate({ username: u.toLowerCase() }, { lastUsername }),
  updateIsPrivate: async (u, isPrivate) => Account.findOneAndUpdate({ username: u.toLowerCase() }, { isPrivate }),

  // ── Stats / History ─────────────────────────────────────────────────────────
  logEvent: async (username, event, detail = '') => Stat.create({ username: username.toLowerCase(), event, detail }),

  getStats: async () => ({
    totalWatched:   await Account.countDocuments(),
    totalBanned:    await Stat.countDocuments({ event: 'banned' }),
    totalRecovered: await Stat.countDocuments({ event: 'recovered' })
  }),

  getHistory: async (username) => Stat.find({ username: username.toLowerCase() }).sort({ timestamp: -1 }).limit(20),
  getLogs:    async ()         => Stat.find().sort({ timestamp: -1 }).limit(10),

  // ── Follower Tracking ────────────────────────────────────────────────────────
  addFollowerTrack: async (username, channelId, followers, threshold, guildId) => {
    await FollowerTrack.findOneAndUpdate(
      { username: username.toLowerCase() },
      { username: username.toLowerCase(), channelId, guildId: guildId || null, followers: parseInt(followers) || 0, threshold: threshold || 0, paused: false, startTime: new Date() },
      { upsert: true, new: true }
    );
  },
  getFollowerTracks:  async () => FollowerTrack.find({ paused: false }),
  getFollowerTrack:   async (u) => FollowerTrack.findOne({ username: u.toLowerCase() }),
  removeFollowerTrack: async (u) => FollowerTrack.deleteOne({ username: u.toLowerCase() }),
  updateFollowerTrackCount: async (u, f) => FollowerTrack.findOneAndUpdate({ username: u.toLowerCase() }, { followers: parseInt(f) || 0 }),

  // ── DM Users ─────────────────────────────────────────────────────────────────
  setDmUser:    async (userId, enabled) => DmUser.findOneAndUpdate({ userId }, { userId, enabled }, { upsert: true }),
  getDmUsers:   async () => DmUser.find({ enabled: true }),
  isDmEnabled:  async (userId) => { const u = await DmUser.findOne({ userId }); return u?.enabled || false; },

  // ── Blacklist ─────────────────────────────────────────────────────────────────
  addBlacklist:    async (u) => Blacklist.findOneAndUpdate({ username: u.toLowerCase() }, { username: u.toLowerCase() }, { upsert: true }),
  removeBlacklist: async (u) => Blacklist.deleteOne({ username: u.toLowerCase() }),
  isBlacklisted:   async (u) => !!(await Blacklist.findOne({ username: u.toLowerCase() })),
  getBlacklist:    async () => Blacklist.find(),

  // ── Config (persists channel IDs etc across restarts) ────────────────────────
  getConfig: async (key) => {
    const doc = await Config.findOne({ key });
    return doc ? doc.value : null;
  },
  setConfig: async (key, value) => {
    await Config.findOneAndUpdate({ key }, { key, value }, { upsert: true });
  },

  // ── Verify Tracking ───────────────────────────────────────────────────────────
  addVerifyTrack:    async (username, channelId, guildId) => {
    await VerifyTrack.findOneAndUpdate(
      { username: username.toLowerCase() },
      { username: username.toLowerCase(), channelId, guildId: guildId || null, startTime: new Date() },
      { upsert: true, new: true }
    );
  },
  getVerifyTracks:   async () => VerifyTrack.find(),
  getVerifyTrack:    async (u) => VerifyTrack.findOne({ username: u.toLowerCase() }),
  removeVerifyTrack: async (u) => VerifyTrack.deleteOne({ username: u.toLowerCase() }),

  // ── Update Channel ────────────────────────────────────────────────────────────
  setUpdateChannel:  async (guildId, channelId) => {
    await UpdateChannel.findOneAndUpdate({ guildId }, { guildId, channelId }, { upsert: true });
  },
  getUpdateChannel:  async (guildId) => UpdateChannel.findOne({ guildId }),
  getAllUpdateChannels: async () => UpdateChannel.find(),
  removeUpdateChannel: async (guildId) => UpdateChannel.deleteOne({ guildId }),

  // ── Guild Access ──────────────────────────────────────────────────────────────
  addGuildAccess:    async (guildId, guildName, addedBy, expiresAt) => {
    await GuildAccess.findOneAndUpdate(
      { guildId },
      { guildId, guildName: guildName || '', addedBy: addedBy || '', addedAt: new Date(), expiresAt: expiresAt || null },
      { upsert: true, new: true }
    );
  },
  removeGuildAccess: async (guildId) => GuildAccess.deleteOne({ guildId }),
  hasGuildAccess:    async (guildId) => {
    const doc = await GuildAccess.findOne({ guildId });
    if (!doc) return false;
    if (doc.expiresAt && new Date() > doc.expiresAt) {
      await GuildAccess.deleteOne({ guildId }); // auto-expire
      return false;
    }
    return true;
  },
  getGuildAccessList: async () => GuildAccess.find(),

  // ── Premium ───────────────────────────────────────────────────────────────────
  addPremium:    async (userId, guildId, addedBy, expiresAt) => {
    await Premium.findOneAndUpdate(
      { userId },
      { userId, guildId: guildId || null, addedBy: addedBy || '', addedAt: new Date(), expiresAt: expiresAt || null },
      { upsert: true, new: true }
    );
  },
  removePremium: async (userId) => Premium.deleteOne({ userId }),
  isPremium:     async (userId) => {
    const doc = await Premium.findOne({ userId });
    if (!doc) return false;
    if (doc.expiresAt && new Date() > doc.expiresAt) {
      await Premium.deleteOne({ userId }); // auto-expire
      return false;
    }
    return true;
  },
  getPremiumList: async () => Premium.find()
};
