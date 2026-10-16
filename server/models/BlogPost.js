const mongoose = require('mongoose');

/* A blog article, written by AI in the Befach Creatives app and POSTed to
   /api/blog/ingest (server/blog.js). Nothing on this site edits them — a
   re-send from the app (its "Retry" button) updates the same row in place.

   The hero image lives IN the document, not on disk: the Render disk does not
   survive a deploy, and the link the app sends expires five minutes after it is
   sent, so this copy is the only one we will ever have. Capped at 10 MB by the
   ingest, well inside Mongo's 16 MB document limit; list queries leave
   `heroImage.data` out. */
const BlogPostSchema = new mongoose.Schema({
  _id: { type: Number },                        // running number from Counter "blog"; sent back as externalId
  sourceCreativeId: { type: String, required: true, unique: true },   // the post's id in the Creatives app
  slug: { type: String, required: true, unique: true },               // set once, never changed: the URL is forever
  title: { type: String, required: true },
  excerpt: { type: String, required: true },
  bodyMarkdown: { type: String, required: true },
  heroImage: {
    type: new mongoose.Schema({ data: Buffer, contentType: String }, { _id: false }),
    default: null
  },
  publishedAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() }
}, { collection: 'blog_posts' });

BlogPostSchema.index({ publishedAt: -1, _id: -1 });   // /blog lists newest first

module.exports = mongoose.model('BlogPost', BlogPostSchema);
