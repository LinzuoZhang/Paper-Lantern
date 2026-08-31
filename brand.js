(() => {
  const localAvatarUrl = "./assets/avatar.local.png";
  const probe = new Image();

  probe.addEventListener("load", () => {
    document.querySelectorAll("img.site-logo").forEach((image) => {
      image.src = localAvatarUrl;
    });
    document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((link) => {
      link.href = localAvatarUrl;
      if (link.rel === "icon") link.type = "image/png";
    });
  });

  probe.src = localAvatarUrl;
})();
