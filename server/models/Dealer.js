const mongoose = require('mongoose');

/* A "Become a Business Partner" / dealership application. Captured WITHOUT login
   from the public dealership landing page, and surfaced in the admin "Dealers"
   tab (and its CSV export) — exactly like demo-kit Leads. */
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
  createdAt: { type: Number, default: () => Date.now(), index: true }
});

module.exports = mongoose.model('Dealer', DealerSchema);
