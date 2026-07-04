/* 線上對戰連線模組（WebRTC P2P，零伺服器）。
   採「邀請碼 / 回應碼」手動互換的標準 WebRTC 握手：不需自架 signaling、不綁帳號，
   純靜態即可運作、無第三方服務依賴。以 Google 公用 STUN 協助 NAT 穿透
   （對稱型 NAT 仍可能連不上，這是無 TURN 伺服器的先天限制）。
   非 trickle：先收集完 ICE 候選再把整包 SDP 編成一段代碼，讓使用者一次複製。 */
(function () {
  'use strict';
  const RTC_CONF = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  function enc(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
  function dec(str) { return JSON.parse(decodeURIComponent(escape(atob(String(str).trim())))); }

  // 等 ICE 候選收集完成（或 3 秒逾時就用已收集到的）
  function waitIce(pc) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const timer = setTimeout(resolve, 3000);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
      });
    });
  }

  function makeConn(handlers) {
    const pc = new RTCPeerConnection(RTC_CONF);
    let dc = null;
    function bind(channel) {
      dc = channel;
      dc.onopen = () => handlers.onOpen && handlers.onOpen();
      dc.onmessage = (e) => { try { handlers.onMessage && handlers.onMessage(JSON.parse(e.data)); } catch {} };
      dc.onclose = () => handlers.onClose && handlers.onClose();
    }
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        handlers.onClose && handlers.onClose();
      }
    });
    return {
      pc, bind,
      get open() { return dc && dc.readyState === 'open'; },
      send(obj) { if (dc && dc.readyState === 'open') dc.send(JSON.stringify(obj)); },
      close() { try { dc && dc.close(); } catch {} try { pc.close(); } catch {} },
    };
  }

  // 主機：產生邀請碼；收到回應碼後 acceptAnswer 完成連線
  async function host(handlers) {
    const conn = makeConn(handlers);
    conn.bind(conn.pc.createDataChannel('game'));
    await conn.pc.setLocalDescription(await conn.pc.createOffer());
    await waitIce(conn.pc);
    conn.offerCode = enc(conn.pc.localDescription);
    conn.acceptAnswer = async (code) => { await conn.pc.setRemoteDescription(dec(code)); };
    return conn;
  }

  // 加入者：吃邀請碼、產生回應碼；回傳給主機後即連線
  async function join(offerCode, handlers) {
    const conn = makeConn(handlers);
    conn.pc.addEventListener('datachannel', (e) => conn.bind(e.channel));
    await conn.pc.setRemoteDescription(dec(offerCode));
    await conn.pc.setLocalDescription(await conn.pc.createAnswer());
    await waitIce(conn.pc);
    conn.answerCode = enc(conn.pc.localDescription);
    return conn;
  }

  window.GomokuNet = { host, join, supported: typeof RTCPeerConnection !== 'undefined' };
})();
