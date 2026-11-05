import { Router } from "express";
import { errors } from "../lib/errors.js";
import { asyncHandler, requireUser } from "../lib/http.js";
import { avatarPathOf, loadProxyAvatar } from "../lib/avatar.js";
import { rateLimit, userKey } from "../lib/rate-limit.js";
import { findUserById } from "../services/users.js";

export const avatarRouter: Router = Router();

avatarRouter.use(requireUser());

/** 头像按浏览器缓存 1 小时，服务端再缓存 6 小时，避免每次渲染都打 QQ 头像 CDN */
const avatarLimit = rateLimit({
  scope: "avatar.fetch",
  limit: 120,
  windowSeconds: 60,
  keyBy: userKey,
  message: "加载头像太频繁了，请稍后再试",
});

avatarRouter.get(
  "/:userId",
  avatarLimit,
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId ?? "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw errors.notFound("头像不存在");

    const user = findUserById(userId);
    if (!user || !user.avatar_url) throw errors.notFound("头像不存在");

    // 历史本地头像（/media/...）直接重定向到本站静态路径，同样不会暴露 QQ 号
    if (!/^https?:\/\//i.test(user.avatar_url)) {
      if (user.avatar_url.startsWith("/media/")) {
        res.redirect(302, user.avatar_url);
        return;
      }
      throw errors.notFound("头像不存在");
    }

    const payload = await loadProxyAvatar(user);
    if (!payload) throw errors.notFound("头像不存在");

    res.setHeader("Content-Type", payload.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(payload.data);
  }),
);

export { avatarPathOf };
