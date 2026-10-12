const mongoose = require('mongoose');

/* A "Become a Business Partner" / dealership application. Captured WITHOUT login
   from the public dealership landing page, and surfaced in the admin "Dealers"
   tab (and its CSV export). */
const DealerSchema = new mongoose.Schema({
  fullName: { type: String, default: '' },
  businessName: { type: String, default: '' },
  mobile: { type: String, index: true, default: '' },
  email: { type: String, default: '' },
  pincode: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  businessType: { type: String, default: '' },
  currentProducts: { type: String, default: '' },
  experience: { type: String, default: '' },
  message: { type: String, default: '' },
  createdAt: { type: Number, default: () => Date.now(), index: true },
  // stamped by mongoose on every write (the option below), in ms like the rest;
  // the partner API's feed hands out rows by it (server/partner.js)
  updatedAt: { type: Number }
}, { timestamps: { createdAt: false, updatedAt: true, currentTime: () => Date.now() } });

module.exports = mongoose.model('Dealer', DealerSchema);
