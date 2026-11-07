/**
 * 个人信息收集清单（「关于」页展示）。
 *
 * 只写站点真实会收集、保存的信息，字段含义：
 * - source：从哪来的（谁在什么时候提供 / 系统自动记录）
 * - purpose：用来做什么（一句话）
 * - visibleTo：谁能看到（本人 / 交易对方 / 平台客服 / 管理员）
 * - retention：保存多久、怎么删
 *
 * 改这份清单时同步检查 `server/src/content/legal.ts` 的隐私协议第 1、5 节表述。
 */

export interface DataCollectionItem {
  /** 信息项名称 */
  name: string;
  /** 是否为使用服务所必需（可选的在留空或关闭后不影响核心流程） */
  required: boolean;
  /** 收集方式 / 来源 */
  source: string;
  /** 用途 */
  purpose: string;
  /** 可见范围 */
  visibleTo: string;
  /** 保存期限与删除方式 */
  retention: string;
}

export interface DataCollectionGroup {
  title: string;
  /** 该分组的补充说明（可选） */
  note?: string;
  items: DataCollectionItem[];
}

export const DATA_COLLECTION_GROUPS: DataCollectionGroup[] = [
  {
    title: "账号与身份",
    items: [
      {
        name: "姓名",
        required: true,
        source: "你首次完善资料时填写",
        purpose: "交易双方核对收款人是谁，扫码付款时展示给对方",
        visibleTo: "本人、交易对方、平台客服、管理员",
        retention: "账号存续期间；历史订单保留下单时的姓名快照，用于交易凭证",
      },
      {
        name: "校学号",
        required: true,
        source: "你首次完善资料时填写",
        purpose: "生成收付款码、校园内身份核对",
        visibleTo: "本人、管理员；交易对方与工单内默认打码，双方申请并由平台批准后才可见",
        retention: "账号存续期间",
      },
      {
        name: "登录邮箱",
        required: true,
        source: "你填写并接收验证码验证后绑定",
        purpose: "接收邮箱验证码、登录与订单通知",
        visibleTo: "本人、管理员",
        retention: "账号存续期间；换绑后旧邮箱从账号中移除，已发送的邮件记录留在邮件记录里用于排查",
      },
      {
        name: "校园卡号",
        required: true,
        source: "你首次完善资料时填写",
        purpose: "校园卡身份核对与校园卡支付",
        visibleTo: "本人、管理员；交易对方与工单内默认打码，披露批准后才可见",
        retention: "账号存续期间",
      },
      {
        name: "QQ 号",
        required: false,
        source: "校园墙登录授权时提供",
        purpose: "只用来取头像，头像由服务端代理，页面上不出现 QQ 号",
        visibleTo: "QQ 号不展示给任何用户；头像对交易双方可见",
        retention: "账号存续期间；更换头像后旧头像链接不再使用",
      },
      {
        name: "校园墙账号标识（sub）",
        required: true,
        source: "校园墙 OAuth 授权回调",
        purpose: "识别是同一个校园墙用户，完成登录",
        visibleTo: "管理员",
        retention: "账号存续期间；访问令牌登录完成后立即作废，不做保存",
      },
    ],
  },
  {
    title: "交易与收款",
    note: "资金通过商家自己的收款码流转，本服务不接触资金，也不保存你的第三方支付账号与密码。",
    items: [
      {
        name: "订单信息（金额、商品、备注、状态、时间线）",
        required: true,
        source: "下单、付款、确认收款等操作时由系统生成",
        purpose: "交易双方核对、订单状态同步与交易统计",
        visibleTo: "交易双方、管理员",
        retention: "长期保存，用于交易凭证、对账与申诉处理",
      },
      {
        name: "付款截图",
        required: false,
        source: "付款人主动上传",
        purpose: "商家核对是否到账",
        visibleTo: "交易双方、管理员",
        retention: "默认 15 天后自动删除（后台可调 1–365 天），删除后订单不再显示该截图",
      },
      {
        name: "收款码图片",
        required: false,
        source: "商家上传（支付宝 / 微信支付 / QQ 钱包）",
        purpose: "付款人扫码付款",
        visibleTo: "付款人扫码时看到由收款码内容重新生成的二维码",
        retention: "上传时只识别并保存二维码内容，原图不落盘；内容保存到商家更换或停用该渠道",
      },
      {
        name: "账单文件（微信 / 支付宝）",
        required: false,
        source: "商家上传用于自动对账",
        purpose: "匹配收款流水，自动确认已到账的订单",
        visibleTo: "上传的商家本人、管理员",
        retention: "默认 1 天后自动删除（后台可调 1–365 天），文件与解析出的流水一并清理",
      },
      {
        name: "支付密码",
        required: true,
        source: "你设置的 6 位数字密码",
        purpose: "下单、转账、修改收款码与退出隐私模式时校验身份",
        visibleTo: "任何人（包括管理员）都看不到明文，只保存不可逆的哈希",
        retention: "账号存续期间；连续输错会临时锁定，重置后旧密码立即失效",
      },
    ],
  },
  {
    title: "沟通与通知",
    items: [
      {
        name: "工单内容（问题描述、消息）",
        required: false,
        source: "你在订单里发起工单并发送消息时产生",
        purpose: "订单争议的站内沟通，平台客服可介入协助",
        visibleTo: "订单双方、平台客服、管理员",
        retention: "长期保存用于纠纷追溯；工单 7 天无新消息自动关闭",
      },
      {
        name: "资料披露申请与审批记录",
        required: false,
        source: "工单里申请披露双方资料、平台审批时产生",
        purpose: "记录谁在什么时候申请、平台怎么处理，避免争议",
        visibleTo: "工单双方、平台客服、管理员",
        retention: "随工单保存",
      },
      {
        name: "通知偏好",
        required: false,
        source: "你在设置页开关邮件通知时保存",
        purpose: "决定哪些事件给你发邮件",
        visibleTo: "本人、管理员",
        retention: "账号存续期间，随时可改",
      },
    ],
  },
  {
    title: "安全与日志",
    items: [
      {
        name: "登录记录（时间、IP、设备）",
        required: true,
        source: "每次登录成功后由系统自动记录",
        purpose: "登录提醒、登录设备管理、识别异常登录",
        visibleTo: "本人（登录设备页）、管理员",
        retention: "长期保存用于安全审计",
      },
      {
        name: "支付密码校验结果（失败次数、锁定状态）",
        required: true,
        source: "校验支付密码时由系统自动记录",
        purpose: "防止暴力破解，触发临时锁定",
        visibleTo: "本人（锁定提示）、管理员",
        retention: "长期保存用于风控追溯；锁定到期自动解除",
      },
      {
        name: "管理端操作审计",
        required: true,
        source: "管理员在后台的敏感操作（改配置、查看用户资料、处理工单与申诉等）自动记录",
        purpose: "合规审计，出现争议时能追溯到人",
        visibleTo: "管理员（只读审计员也可查看，但不能修改）",
        retention: "长期保存",
      },
      {
        name: "登录会话",
        required: true,
        source: "登录成功时由系统生成",
        purpose: "保持登录状态",
        visibleTo: "仅系统使用；数据库里只存令牌的哈希",
        retention: "默认 7 天过期（后台可调）；退出登录或被强制下线时立即删除",
      },
    ],
  },
];

export const DATA_COLLECTION_COUNT = DATA_COLLECTION_GROUPS.reduce(
  (total, group) => total + group.items.length,
  0,
);
