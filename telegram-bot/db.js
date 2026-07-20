const mongoose = require('mongoose');

// ─── Schemas ──────────────────────────────────────────────────────────────────
const accountSchema = new mongoose.Schema({
  username:       { type: String, required: true, unique: true, lowercase: true },
  chatId:         { type: String, required: true },   // Telegram chat ID
  followers:      { type: Number, default: 0 },
  lastStatus:     { type: String, enum: ['active', 'banned'], default: 'active' },
  failCount:      { type: Number, default: 0 },
  startTime:      { type: Date, default: Date.now },
  lastChangeTime: { type: Date, default: null }
});

const statSchema = new mongoose.Schema({
  event:     { type: String, enum: ['banned', 'recovered'] },
  username:  { type: String, lowercase: true },
  detail:    { type: String, default: '' },
  timestamp: { type: Date, default: Date.now }
});

const Account = mongoose.model('Account', accountSchema);
const Stat    = mongoose.model('Stat',    statSchema);

// ─── Connect ──────────────────────────────────────────────────────────────────
async function connect() {
  const uri = process.env.MONGODB_URI_TG;
  if (!uri) { console.error('[DB] MONGODB_URI_TG not set!'); return false; }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    console.log(`[DB] Connected: ${uri.split('@')[1]?.split('/')[0]}`);
    return true;
  } catch (err) {
    console.error(`[DB] Failed: ${err.message}`);
    return false;
  }
}

module.exports = {
  connect,

  addAccount: async (username, chatId, status, followers) => {
    await Account.findOneAndUpdate(
      { username: username.toLowerCase() },
      { username: username.toLowerCase(), chatId: String(chatId), followers: followers ? parseInt(followers) : 0, lastStatus: status, failCount: 0, startTime: new Date(), lastChangeTime: null },
      { upsert: true, new: true }
    );
  },

  getAccounts:       async () => Account.find({ failCount: { $lt: 5 } }),
  getBanWatchList:   async () => Account.find({ lastStatus: 'active',  failCount: { $lt: 5 } }),
  getUnbanWatchList: async () => Account.find({ lastStatus: 'banned',  failCount: { $lt: 5 } }),
  getAccount:        async (u) => Account.findOne({ username: u.toLowerCase() }),
  removeAccount:     async (u) => Account.deleteOne({ username: u.toLowerCase() }),

  updateStatus:    async (u, status) => Account.findOneAndUpdate({ username: u.toLowerCase() }, { lastStatus: status, lastChangeTime: new Date(), failCount: 0 }),
  incrementFail:   async (u) => Account.findOneAndUpdate({ username: u.toLowerCase() }, { $inc: { failCount: 1 } }),
  resetFail:       async (u) => Account.findOneAndUpdate({ username: u.toLowerCase() }, { failCount: 0 }),
  updateFollowers: async (u, f) => Account.findOneAndUpdate({ username: u.toLowerCase() }, { followers: parseInt(f) || 0 }),

  logEvent: async (username, event, detail = '') => Stat.create({ username: username.toLowerCase(), event, detail }),

  getStats: async () => ({
    totalWatched:   await Account.countDocuments(),
    totalBanned:    await Stat.countDocuments({ event: 'banned' }),
    totalRecovered: await Stat.countDocuments({ event: 'recovered' })
  }),

  getHistory: async (username) => Stat.find({ username: username.toLowerCase() }).sort({ timestamp: -1 }).limit(10),
};
