/* 首页轮播初始化（仅在精选卡片多于 1 篇时才会被加载）
 *
 * 相比原插件的 swiper_init.js 改了两点：
 *   1. 等到 window.load（样式与封面图都已就绪）再初始化，
 *      避免在 CSS 未生效时算出错误尺寸；
 *   2. 监听 resize 后调用 swiper.update()，窗口尺寸变化不会再错位。
 */
(function () {
  'use strict';

  var started = false;

  function boot() {
    if (started) return;

    var el = document.getElementById('swiper_container');
    if (!el || typeof Swiper === 'undefined') return;

    var slides = el.querySelectorAll('.swiper-slide');
    if (slides.length <= 1) return;

    started = true;

    var swiper = new Swiper(el, {
      effect: 'fade',
      loop: slides.length > 1,
      spaceBetween: 30,
      autoplay: {
        disableOnInteraction: true,
        delay: 3000
      },
      mousewheel: true,
      pagination: {
        el: '.blog-slider__pagination',
        clickable: true
      }
    });

    el.addEventListener('mouseenter', function () {
      if (swiper.autoplay) swiper.autoplay.stop();
    });
    el.addEventListener('mouseleave', function () {
      if (swiper.autoplay) swiper.autoplay.start();
    });

    var timer;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (swiper && swiper.update) swiper.update();
      }, 200);
    });
  }

  if (document.readyState === 'complete') {
    boot();
  } else {
    window.addEventListener('load', boot);
  }
})();
