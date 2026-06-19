// Inline Lucide-style icon strings for dynamically-built markup (cart toast, variant button labels).
// Kept in sync with snippets/icon.liquid.
const PPICON = {
  zap: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  check: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><path d="M20 6 9 17l-5-5"/></svg>'
};

// SCROLL REVEAL
const io = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }});
},{threshold:.12,rootMargin:'0px 0px -60px 0px'});
document.querySelectorAll('[data-reveal]').forEach(el=>io.observe(el));

// NUMBER COUNTER
document.querySelectorAll('[data-counter]').forEach(el=>{
  const target=+el.dataset.counter; let cur=0; const step=Math.max(1,Math.ceil(target/60));
  const ob=new IntersectionObserver(es=>{ if(es[0].isIntersecting){
    const t=setInterval(()=>{ cur+=step; if(cur>=target){cur=target;clearInterval(t)} el.textContent=cur.toLocaleString(); },22);
    ob.disconnect();
  }},{threshold:.4}); ob.observe(el);
});

// 3D TILT
document.querySelectorAll('.tilt').forEach(c=>{
  c.addEventListener('mousemove',e=>{
    const r=c.getBoundingClientRect(); const x=(e.clientX-r.left)/r.width-.5; const y=(e.clientY-r.top)/r.height-.5;
    c.style.setProperty('--ry',(x*10)+'deg'); c.style.setProperty('--rx',(-y*10)+'deg');
  });
  c.addEventListener('mouseleave',()=>{ c.style.setProperty('--rx','0deg'); c.style.setProperty('--ry','0deg'); });
});

// MAGNETIC BUTTONS
document.querySelectorAll('.magnetic').forEach(b=>{
  b.addEventListener('mousemove',e=>{
    const r=b.getBoundingClientRect(); const x=e.clientX-r.left-r.width/2; const y=e.clientY-r.top-r.height/2;
    b.style.transform=`translate(${x*.25}px,${y*.25}px)`;
  });
  b.addEventListener('mouseleave',()=>{ b.style.transform='translate(0,0)'; });
});

// CUSTOM CURSOR
const dot=document.createElement('div'); dot.className='cursor-dot';
const ring=document.createElement('div'); ring.className='cursor-ring';
document.body.append(dot,ring);
let mx=0,my=0,rx=0,ry=0;
window.addEventListener('mousemove',e=>{ mx=e.clientX; my=e.clientY; dot.style.left=mx+'px'; dot.style.top=my+'px'; });
function loop(){ rx+=(mx-rx)*.18; ry+=(my-ry)*.18; ring.style.left=rx+'px'; ring.style.top=ry+'px'; requestAnimationFrame(loop); } loop();
document.querySelectorAll('a,button,.tilt,.btn').forEach(el=>{
  el.addEventListener('mouseenter',()=>{ ring.style.width='60px'; ring.style.height='60px'; });
  el.addEventListener('mouseleave',()=>{ ring.style.width='36px'; ring.style.height='36px'; });
});

// PARALLAX
document.querySelectorAll('[data-parallax]').forEach(el=>{
  const speed=parseFloat(el.dataset.parallax)||.2;
  window.addEventListener('scroll',()=>{ const y=window.scrollY*speed; el.style.transform=`translate3d(0,${y}px,0)`; },{passive:true});
});

// BEFORE/AFTER COMPARE
document.querySelectorAll('.compare').forEach(c=>{
  const after=c.querySelector('.after'); const handle=c.querySelector('.handle');
  if(!after||!handle)return; // no before/after images uploaded yet — nothing to drag
  const move=clientX=>{ const r=c.getBoundingClientRect(); let p=((clientX-r.left)/r.width)*100; p=Math.max(0,Math.min(100,p));
    after.style.clipPath=`inset(0 0 0 ${p}%)`; handle.style.left=p+'%';
  };
  let drag=false;
  c.addEventListener('mousedown',e=>{drag=true;move(e.clientX)});
  window.addEventListener('mousemove',e=>{if(drag)move(e.clientX)});
  window.addEventListener('mouseup',()=>drag=false);
  c.addEventListener('touchstart',e=>{drag=true;move(e.touches[0].clientX)},{passive:true});
  window.addEventListener('touchmove',e=>{if(drag)move(e.touches[0].clientX)},{passive:true});
  window.addEventListener('touchend',()=>drag=false);
});

// MULTI-STEP FORM
document.querySelectorAll('[data-multi-form]').forEach(f=>{
  const steps=[...f.querySelectorAll('[data-step]')]; let i=0;
  const show=()=>steps.forEach((s,k)=>s.style.display=k===i?'block':'none');
  f.querySelectorAll('[data-next]').forEach(b=>b.addEventListener('click',()=>{
    const req=[...steps[i].querySelectorAll('[required]')]; if(req.some(r=>!r.reportValidity()))return;
    i=Math.min(i+1,steps.length-1); show();
  }));
  f.querySelectorAll('[data-prev]').forEach(b=>b.addEventListener('click',()=>{ i=Math.max(0,i-1); show(); }));
  // Honeypot: a real user never sees/fills this; a bot does -> silently drop the submit.
  const hp=f.querySelector('[data-honeypot]');
  f.addEventListener('submit',e=>{ if(hp&&hp.value.trim()!==''){ e.preventDefault(); e.stopPropagation(); } });
  show();
});

// PRODUCT GALLERY — click/keyboard a thumbnail to swap the main image
(function(){
  const main=document.querySelector('[data-pp-main]');
  const thumbs=[...document.querySelectorAll('[data-pp-thumb]')];
  if(!main||!thumbs.length)return;
  const swap=t=>{
    if(!t.dataset.full)return;
    main.style.opacity='0'; // fade out, fade back in once the new image is decoded
    const done=()=>{ main.style.opacity='1'; main.removeEventListener('load',done); };
    main.addEventListener('load',done);
    main.src=t.dataset.full;
    thumbs.forEach(x=>x.style.borderColor='#E2E8F0'); t.style.borderColor='#00B4D8';
  };
  thumbs.forEach(t=>{
    t.addEventListener('click',()=>swap(t));
    t.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); swap(t); } });
  });
})();

// PRODUCT VARIANTS — keep hidden variant id, price and stock in sync with the selected options
(function(){
  const form=document.querySelector('[data-pp-form]');
  const dataEl=document.querySelector('[data-pp-variants]');
  if(!form||!dataEl)return;
  let variants; try{ variants=JSON.parse(dataEl.textContent); }catch(e){ return; }
  if(!Array.isArray(variants)||!variants.length)return;

  const idInput=form.querySelector('[data-pp-id]');
  const priceEl=document.querySelector('[data-pp-price]');
  const atc=form.querySelector('[data-pp-atc]');
  const buynow=form.querySelector('[data-pp-buynow]');
  const stockWrap=document.querySelector('[data-pp-stock]');
  const stockDot=document.querySelector('[data-pp-stock-dot]');
  const stockText=document.querySelector('[data-pp-stock-text]');

  const selected=()=>[...form.querySelectorAll('input[name^="options"]:checked')].map(r=>r.value);
  const disable=(btn)=>{ if(!btn)return; btn.disabled=true; btn.style.opacity='.5'; btn.style.cursor='not-allowed'; btn.style.pointerEvents='none'; };
  const enable=(btn)=>{ if(!btn)return; btn.disabled=false; btn.style.opacity=''; btn.style.cursor=''; btn.style.pointerEvents=''; };

  const update=()=>{
    const opts=selected();
    if(!opts.length)return; // single-variant product — nothing to react to
    const match=variants.find(v=>v.options.length===opts.length && v.options.every((o,i)=>o===opts[i]));
    if(!match){ disable(atc); disable(buynow); if(atc)atc.textContent='Unavailable'; if(stockText)stockText.textContent='This combination is unavailable'; return; }
    if(idInput)idInput.value=match.id;
    if(priceEl)priceEl.innerHTML=match.price; // match.price is our own shop money-format string
    if(match.available){
      enable(atc); enable(buynow);
      if(atc)atc.innerHTML='Add to Cart · <span data-pp-atc-price>'+match.price+'</span>';
      if(buynow)buynow.innerHTML='Buy it now '+PPICON.zap;
      if(stockWrap)stockWrap.style.background='#ECFDF5';
      if(stockDot){ stockDot.style.background='#22C55E'; stockDot.style.boxShadow='0 0 0 4px rgba(34,197,94,.2)'; }
      if(stockText){ stockText.style.color='#065F46'; stockText.textContent='In stock · Ships in 24 hours'; }
    } else {
      disable(atc); disable(buynow);
      if(atc)atc.textContent='Sold out';
      if(buynow)buynow.textContent='Unavailable';
      if(stockWrap)stockWrap.style.background='#FEF2F2';
      if(stockDot){ stockDot.style.background='#EF4444'; stockDot.style.boxShadow='none'; }
      if(stockText){ stockText.style.color='#991B1B'; stockText.textContent='Sold out'; }
    }
  };

  // Strike through / dim option values that have no available variant given the other choices
  const optionInputs=[...form.querySelectorAll('input[name^="options"]')];
  const markAvailability=()=>{
    const current=selected(); if(!current.length)return;
    optionInputs.forEach(inp=>{
      const pos=+inp.dataset.optPos; const cand=current.slice(); cand[pos]=inp.value;
      const ok=variants.some(v=>v.available && v.options.length===cand.length && v.options.every((o,i)=>o===cand[i]));
      const pill=inp.nextElementSibling; if(!pill)return;
      pill.style.textDecoration = ok ? '' : 'line-through';
      pill.style.opacity = ok ? '' : '.45';
      if(ok){ pill.removeAttribute('title'); } else { pill.title='Unavailable'; }
    });
  };

  const run=()=>{ update(); markAvailability(); };
  optionInputs.forEach(r=>r.addEventListener('change',run));
  markAvailability(); // initial pass (price/stock already correct from Liquid)
})();

// AJAX ADD-TO-CART — update cart bubble + show a premium toast, with a safe native fallback
(function(){
  const form=document.querySelector('[data-pp-form]');
  if(!form||typeof window.routes==='undefined'||!window.routes.cart_add_url)return;
  const cartUrl=window.routes.cart_url||'/cart';

  let toastEl;
  const toast=msg=>{
    if(!toastEl){ toastEl=document.createElement('div'); toastEl.className='pp-toast'; toastEl.setAttribute('role','status'); document.body.appendChild(toastEl); }
    toastEl.innerHTML=msg; toastEl.classList.add('show');
    clearTimeout(toastEl._t); toastEl._t=setTimeout(()=>toastEl.classList.remove('show'),4000);
  };
  const refreshBubble=async()=>{
    try{
      const res=await fetch(cartUrl+'.js',{headers:{'Accept':'application/json'}}); if(!res.ok)return;
      const cart=await res.json();
      const wrap=document.getElementById('cart-icon-bubble'); if(!wrap)return;
      let bubble=wrap.querySelector('.cart-count-bubble');
      if(cart.item_count>0){
        if(!bubble){ bubble=document.createElement('div'); bubble.className='cart-count-bubble'; wrap.appendChild(bubble); }
        bubble.innerHTML='<span aria-hidden="true">'+(cart.item_count<100?cart.item_count:'')+'</span>';
      } else if(bubble){ bubble.remove(); }
    }catch(e){}
  };

  form.addEventListener('submit',async e=>{
    if(e.submitter && e.submitter.name==='checkout')return; // Buy it now -> native submit to checkout
    e.preventDefault();
    const btn=form.querySelector('[data-pp-atc]'); const orig=btn?btn.innerHTML:'';
    if(btn){ btn.disabled=true; btn.style.opacity='.7'; btn.innerHTML='Adding…'; }
    try{
      const res=await fetch(window.routes.cart_add_url,{method:'POST',headers:{'Accept':'application/javascript'},body:new FormData(form)});
      if(!res.ok)throw new Error('add failed');
      await refreshBubble();
      toast(PPICON.check+'Added to cart · <a href="'+cartUrl+'" style="color:#90E0EF;font-weight:700;text-decoration:underline">View cart</a>');
      if(btn){ btn.disabled=false; btn.style.opacity=''; btn.innerHTML=orig; }
    }catch(err){
      if(btn){ btn.disabled=false; btn.style.opacity=''; btn.innerHTML=orig; }
      form.submit(); // never block a purchase — fall back to a normal POST
    }
  });
})();

// QUANTITY STEPPER (replaces the old inline onclick handlers)
document.querySelectorAll('[data-pp-qty]').forEach(w=>{
  const input=w.querySelector('input[type="number"]'); if(!input)return;
  w.querySelectorAll('[data-qty]').forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.qty==='plus')input.stepUp(); else input.stepDown();
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }));
});

// BACK TO TOP
(function(){
  const btn=document.getElementById('pp-back-to-top');
  if(!btn)return;
  // Hide while any Dawn overlay (cart drawer / menu / modal) is open — Dawn locks body scroll then.
  const overlayOpen=()=>document.body.classList.contains('overflow-hidden');
  const onScroll=()=>{ btn.classList.toggle('show', window.scrollY>500 && !overlayOpen()); };
  window.addEventListener('scroll',onScroll,{passive:true}); onScroll();
  btn.addEventListener('click',()=>{
    if(window.lenis && window.lenis.scrollTo){ window.lenis.scrollTo(0); }
    else { window.scrollTo({top:0,behavior:'smooth'}); }
  });
})();