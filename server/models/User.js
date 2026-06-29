const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
  id: String,
  name: String,
  phone: String,
  line: String,
  city: String,
  state: String,
  pincode: String,
  landmark: String
}, { _id: false });

const UserSchema = new mongoose.Schema({
  mobile: { type: String, unique: true, index: true, required: true },
  name: { type: String, default: '' },
  email: { type: String, default: '' },
  avatar: { type: String, default: '' },
  provider: { type: String, default: 'phone' },
  addresses: { type: [AddressSchema], default: [] },
  defaultAddressId: { type: String, default: null },
  logins: { type: Number, default: 0 },
  lastLogin: { type: Number, default: null },
  freeKitClaimed: { type: Boolean, default: false },   // one free demo kit per account
  freeKitAt: { type: Number, default: null },          // when they claimed it
  freeKitInfo: { type: Object, default: null },        // the details they submitted
  createdAt: { type: Number, default: () => Date.now() }
});

module.exports = mongoose.model('User', UserSchema);
