D'Cal — static website (plain HTML / CSS / JS)
=================================================

This folder is your Shopify theme converted to a normal static website.
No Shopify and no Node.js are needed to view or host it.

HOW TO VIEW
  Double-click  index.html  (opens in your browser).

HOW TO PUBLISH
  Upload this whole folder to any static host:
    - Netlify / Vercel  : drag-and-drop this folder
    - GitHub Pages       : push the folder contents
    - Normal web hosting : upload via FTP/cPanel to public_html

PAGES
  index.html ............ home landing page
  product.html .......... product detail page
  collection.html ....... shop / product grid
  collections.html ...... list of collections
  cart.html ............. cart page
  page.html / contact.html ... about & contact
  blog.html / article.html ... journal
  search.html, 404.html, login.html, register.html, account.html, etc.

IMAGES
  The real product/photo artwork lives in the  images/  folder and is now
  wired into every page (product cards, demo/comparison shots, journal, etc.).
  Note: the folder name is lowercase  images/  so it works on case-sensitive
  hosts (Netlify / Vercel / GitHub Pages), not only on Windows.
  To swap a picture: drop a new file into  images/  and update its filename in
  the matching  <img src="images/...">  reference in the HTML.

WHAT IS NOT INCLUDED (needs a real backend)
  Shopify handled checkout, payments, real cart, login and the demo-kit form.
  Those buttons are visual only in this static version. To make them work,
  connect them to your own backend / form service / payment provider.
