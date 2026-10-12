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
  googleId: { type: String, default: null, index: true },   // Google account id (sub) once linked
  name: { type: String, default: '' },
  email: { type: String, default: '' },
  avatar: { type: String, default: '' },
  provider: { type: String, default: 'phone' },              // 'phone' | 'google'
  addresses: { type: [AddressSchema], default: [] },
  defaultAddressId: { type: String, default: null },
  logins: { type: Number, default: 0 },
  lastLogin: { type: Number, default: null },
  createdAt: { type: Number, default: () => Date.now() },
  // stamped by mongoose on every write (the option below), in ms like the rest;
  // the partner API's feed hands out rows by it (server/partner.js)
  updatedAt: { type: Number }
}, { timestamps: { createdAt: false, updatedAt: true, currentTime: () => Date.now() } });

module.exports = mongoose.model('User', UserSchema);
