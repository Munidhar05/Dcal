Unused theme assets (archive)
=============================

These 135 files are from the original Shopify (Dawn) theme but are NOT used by
the current static site. They were moved here so nothing is lost:

  - 87 icon SVGs   (the site inlines its icons directly in the HTML instead)
  - 30 CSS files   (unused Dawn component/section stylesheets)
  - 17 JS files    (unused Dawn scripts)
  -  1 PNG         (og-image.png — social-share image, not referenced)

The live website only needs the files in:  css/  js/  img/  images/

This folder is safe to delete if you don't need any of these. To bring a file
back into use, move it into css/ js/ or img/ and add a matching <link>/<script>
tag (or url(...) reference) in the relevant HTML/CSS.
