/**
 * avataruse.js
 * 模拟用户进房 + 自动上麦（0-9）
 */

const WebSocket = require('ws');
const { createClient } = require('redis');
const axios = require('axios');

/* ================= Redis 配置 ================= */
const REDIS_HOST = '18.143.251.152';
const REDIS_PORT = 7001;
const REDIS_PASSWORD = '!@#$%^poiuy';
const REDIS_DB = 0;
const HASH_KEY = 'yingtao_uid_ticket';

/* ================= WebSocket 配置 ================= */
const wsUrl = 'ws://test.hawatalk.com:3006/imserver/';
const roomId = 16529393;
const appVersion = '3.1.0';
const os = 'android';
const heartBeatInterval = 10000;

/* ================= HTTP 上麦配置 ================= */
const UP_MIC_URL = 'http://test.hawatalk.com/hawa/room/mic/v2/upmic';
/* ================= 麦位头像佩戴 ================= */
const USE_MIC_AVATAR_URL = 'http://test.hawatalk.com/room/theme/mic/avatar/use';

/* ================= 麦位头像配置 ================= */
// 10麦生日主题avatarid
const MIC_AVATAR_IDS = [822, 823,824, 825, 826, 827, 828, 829, 830, 831, 832, 833, 834, 835,836];

/* ================= ticket非空 校验 ================= */
function isValidTicket(ticket) {
  if (ticket === null || ticket === undefined) return false;
  if (typeof ticket !== 'string') return false;

  const t = ticket.trim();
  if (!t) return false;
  if (t === 'null' || t === 'undefined') return false;

  return true;
}
/* ================= 上麦成功校验 ================= */
const ALREADY_ON_MIC_CODES = new Set([
  16002, // 已在其他房间麦上
    0   //所有用户已上麦
]);

const ALREADY_UP_MIC_CODES = new Set([
  200, // 成功上麦
    0,   //所有用户已上麦
    603   //锁麦。遇到锁麦跳过
]);
//检查用户成功上麦
function isUpMicSuccess(resData) {
  return resData && ALREADY_UP_MIC_CODES.has(resData.code);
}

//检查用户在其他房间的麦上，若在，跳过该用户，遍历其他用户
function isAlreadyOnMic(resData) {
  return resData && ALREADY_ON_MIC_CODES.has(resData.code);
}
/* ================= 使用麦位头像 ================= */
async function useMicAvatar({ ticket, roomUid, micAvatarId }) {

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'hawaApp',
    'is-t': 'true',
    'X-TI': ticket,
  };

  const body = {
    isUse: 1,
    micAvatarId,        // 动态传入
    micAvatarType: 1,
    roomUid: Number(roomUid),
  };

  return axios.post(USE_MIC_AVATAR_URL, body, { headers });
}

/* ================= Redis 取用户 ================= */
async function fetchRandomUsers(limit = 1000) {
  const client = createClient({
    socket: { host: REDIS_HOST, port: REDIS_PORT },
    password: REDIS_PASSWORD,
    database: REDIS_DB,
  });

  await client.connect();
  let cursor = '0';
  const users = [];

  do {
    const res = await client.hScan(
        HASH_KEY,
        cursor,
        { COUNT: 200 }
    );
    cursor = String(res.cursor);

    console.log('hScan返回:', res);

    // items
    if (Array.isArray(res.items)) {
      for (let i = 0; i < res.items.length; i += 2) {
        const uid = res.items[i];
        const ticket = res.items[i + 1];
        // console.log('items', uid, ticket);
        if (!isValidTicket(ticket)) continue;
          users.push({ uid, ticket });
          if (users.length >= limit) break;
        }
      }

    // tuples
    else if (Array.isArray(res.tuples)) {
      for (const { field, value } of res.tuples) {
        if (!isValidTicket(value)) continue;
        // console.log('tuples', field, value);
          users.push({ uid: field, ticket: value });
          if (users.length >= limit) break;
        }
      }
  } while (cursor !== '0' && users.length < limit);

  await client.quit();
  console.log(` 实际取到有效 ticket 用户数: ${users.length}`);
  return users;
}

/* ================= 上麦 ================= */
async function upMic({ uid, ticket, position }) {
  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-OS': 'android',
    'X-AV': '2.7.0',
    'X-APP': 'xchat',
    'X-T': Date.now().toString(),
    'User-Agent': 'hawaApp',
    'is-t': 'true',
  };

  const body = {
    roomId: String(roomId),
    position: String(position),
    uid: String(uid),
    micUid: String(uid),
    operator: String(uid),
    ticket,
    os: 'android',
    micStatus: '1',
    appVersionStatus: '4',
  };

  return axios.post(UP_MIC_URL, body, { headers });
}
(async () => {
  const users = await fetchRandomUsers(500);
  console.log(`获取用户数: ${users.length}`);

  let userIndex = 150;      // 当前使用到第几个用户
  const MAX_MIC = 15;     // 麦位 0-14

  for (let micPos = 0; micPos < MAX_MIC; micPos++) {

    let micFilled = false;

    while (!micFilled && userIndex < users.length) {
      const user = users[userIndex++];

      // ===== ticket 校验 =====
      if (!isValidTicket(user.ticket)) {
        console.warn(`跳过无效 ticket uid=${user.uid}`);
        continue;
      }

      console.log(` 尝试 uid=${user.uid} 上麦 麦位=${micPos}`);

      const ws = new WebSocket(wsUrl);

      await new Promise(resolve => {
        ws.on('open', () => {
          // 登录
          ws.send(JSON.stringify({
            route: 'login',
            req_data: {
              ticket: user.ticket,
              uid: user.uid,
              page_name: 2,
              supportBatch: true,
              appVersion,
              appCode: '380',
            }
          }));

          // 进房
          ws.send(JSON.stringify({
            route: 'enterChatRoom',
            req_data: {
              room_id: roomId,
              os,
              enterType: 0,
              appVersion,
            }
          }));

          // 延迟上麦
          setTimeout(async () => {
            try {
              const res = await upMic({
                uid: user.uid,
                ticket: user.ticket,
                position: micPos,
              });

              const data = res.data;

              // ===== 核心判断 =====
              if (isUpMicSuccess(data)) {
                      console.log(`✅ 麦位 ${micPos} 上麦成功 uid=${user.uid}`);

                      const micAvatarId = MIC_AVATAR_IDS[micPos];

                      if (!micAvatarId) {
                        console.warn(`⚠️ 麦位 ${micPos} 未配置 micAvatarId，跳过佩戴`);
                      } else {
                        try {
                          const avatarRes = await useMicAvatar({
                            ticket: user.ticket,
                            roomUid: 9334,//roomId房主的uid
                            micAvatarId,
                          });

                          console.log(
                            `🎭 佩戴麦位头像成功 uid=${user.uid} micPos=${micPos} avatarId=${micAvatarId}`,
                            avatarRes.data
                          );
                        } catch (err) {
                          console.error(
                            `❌ 佩戴麦位头像失败 uid=${user.uid} micPos=${micPos}`,
                            err.response?.data || err.message
                          );
                        }
                      }

                      micFilled = true;
                    }
              else if (isAlreadyOnMic(data)) {
                console.warn(`⚠️ uid=${user.uid} 已在其他房间麦上，换下一个`);
              }
              else {
                console.error(`❌ uid=${user.uid} 上麦失败`, data);
              }

            } catch (err) {
              console.error(`❌ uid=${user.uid} 请求异常`, err.response?.data || err.message);
            } finally {
              resolve(); // 尝试结束，进入下一个用户 or 下一个麦位
            }
          }, 1500);

          // 心跳
          setInterval(() => {
            ws.send(JSON.stringify({ route: 'heartbeat', stg: 0 }));
          }, heartBeatInterval);
        });
      });
    }

    if (!micFilled) {
      console.error(`🚨 麦位 ${micPos} 未能成功填充（用户耗尽）`);
    }
  }

  console.log('🎯 上麦流程结束');
})();

