export function createGame({ mount, sdk, ready, tweaks, assets }) {
  let cleanup = () => {};

  // Audio Context and Synth Sound Helper
  let audioCtx = null;
  function playSound(type) {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { return; }
    }
    try {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'buy') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'claim') {
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);

        osc.type = 'sine';
        osc2.type = 'triangle';

        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.22); // G5
        osc2.frequency.setValueAtTime(659.25, now + 0.06); // E5
        osc2.frequency.exponentialRampToValueAtTime(1046.50, now + 0.25); // C6

        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        gain2.gain.setValueAtTime(0.06, now + 0.06);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.start(now);
        osc.stop(now + 0.25);
        osc2.start(now + 0.06);
        osc2.stop(now + 0.25);
      } else if (type === 'error') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.linearRampToValueAtTime(80, now + 0.15);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    } catch (err) {
      console.warn("Audio synth error:", err);
    }
  }

  // Haptic feedback helper
  function triggerHaptic(duration = 20) {
    try {
      if (sdk?.device?.haptics?.isSupported()) {
        sdk.device.haptics.vibrate(duration);
      }
    } catch (e) {}
  }

  // --- GAME STATE ---
  let state = {
    usdt: 0,
    btc: 0,
    clickLevel: 1,
    autoMineLevel: 0,
    totalClicks: 0,
    lastDailyRewardTime: 0,
    achievementsClaimed: [],
    rebirths: 0
  };

  const initialBtcRate = tweaks?.get('initialBtcRate') ?? 65000;
  const initialUsdtPerClick = tweaks?.get('initialUsdtPerClick') ?? 1;
  const marketUpdateInterval = tweaks?.get('marketUpdateInterval') ?? 6;
  const dailyRewardUsdt = tweaks?.get('dailyRewardUsdt') ?? 300;
  const dailyRewardBtc = tweaks?.get('dailyRewardBtc') ?? 0.002;

  let btcRate = initialBtcRate;
  let priceHistory = [];

  let tempRate = btcRate - 1500;
  for (let i = 0; i < 18; i++) {
    tempRate += Math.round((Math.random() - 0.46) * 450);
    priceHistory.push(Math.max(1000, tempRate));
  }
  priceHistory.push(btcRate);

  function getIncomeMultiplier() {
    if (state.rebirths === 0) return 1.0;
    let totalPercent = 0;
    for (let i = 1; i <= state.rebirths; i++) {
      totalPercent += 3 + (i - 1) * 1;
    }
    return 1 + (totalPercent / 100);
  }

  function getRebirthCost() {
    return 0.01 * Math.pow(2.0, state.rebirths);
  }

  const ACHIEVEMENTS = [
    { id: "clicks_10", title: "Первый шаг", desc: "Сделать 10 кликов по монете", targetType: "clicks", targetValue: 10, rewardUsdt: 50, rewardBtc: 0 },
    { id: "clicks_100", title: "Клик-Мастер", desc: "Сделать 100 кликов по монете", targetType: "clicks", targetValue: 100, rewardUsdt: 300, rewardBtc: 0 },
    { id: "usdt_1000", title: "Начальный капитал", desc: "Накопить 1000 USDT", targetType: "usdt", targetValue: 1000, rewardUsdt: 0, rewardBtc: 0.005 },
    { id: "usdt_25000", title: "Крипто Кит", desc: "Накопить 25,000 USDT", targetType: "usdt", targetValue: 25000, rewardUsdt: 0, rewardBtc: 0.05 },
    { id: "btc_1", title: "Биткоин Ходлер", desc: "Купить 1 BTC", targetType: "btc", targetValue: 1, rewardUsdt: 5000, rewardBtc: 0 },
    { id: "automine_5", title: "Автоматизация", desc: "Улучшить автомайнинг до 5 уровня", targetType: "automine", targetValue: 5, rewardUsdt: 1000, rewardBtc: 0 }
  ];

  async function loadState() {
    try {
      const loaded = await sdk?.gameState?.load();
      if (loaded) state = { ...state, ...loaded };
    } catch (e) {
      const saved = localStorage.getItem('crypto_clicker_save');
      if (saved) state = JSON.parse(saved);
    }
  }

  async function saveState() {
    try {
      await sdk?.gameState?.save(state);
    } catch (e) {}
    localStorage.setItem('crypto_clicker_save', JSON.stringify(state));
  }

  function getClickIncome() {
    return state.clickLevel * initialUsdtPerClick * getIncomeMultiplier();
  }

  function getAutoMineIncome() {
    return state.autoMineLevel * 2 * getIncomeMultiplier();
  }

  function getUpgradeCost(level) {
    return Math.round(15 * Math.pow(1.5, level - 1));
  }

  function getAutoMineCost(level) {
    return Math.round(80 * Math.pow(1.6, level));
  }

  return {
    async start() {
      await loadState();

      const shell = document.createElement("div");
      shell.className = "game-wrapper";

      shell.innerHTML = `
        <header class="game-header">
          <div class="balance-panel">
            <div class="currency-row"><span class="currency-icon usdt">$</span><span class="currency-val usdt" id="usdt-balance">0.00 USDT</span></div>
            <div class="currency-row"><span class="currency-icon btc">₿</span><span class="currency-val btc" id="btc-balance">0.00000000 BTC</span></div>
          </div>
          <div class="rate-widget">
            <span class="rate-label">Курс BTC</span>
            <span class="rate-value" id="btc-rate-ticker">$${btcRate.toLocaleString()} <span class="rate-arrow">●</span></span>
          </div>
          <div class="header-actions">
            <button class="action-icon-btn" id="reset-btn" title="Сбросить прогресс">↺</button>
          </div>
        </header>

        <main class="game-center">
          <div class="coin-container">
            <div class="coin-pulse-ring"></div>
            <button class="coin-button" id="main-coin">
              <div class="coin-inner-glow"></div>
              <span class="coin-symbol">₮</span>
              <span class="coin-label">Клик</span>
            </button>
          </div>
          <span class="click-power-text" id="click-power">Доход за клик: +1 USDT</span>
          <div id="float-container" style="position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 100;"></div>
        </main>

        <footer class="game-footer">
          <div class="footer-row">
            <button class="footer-btn" id="achievements-btn"><span class="btn-icon">🏆</span><span class="btn-text">Достижения</span></button>
            <button class="footer-btn" id="daily-btn"><span class="btn-icon">🎁</span><span class="btn-text">Награда</span></button>
            <button class="footer-btn" id="market-btn"><span class="btn-icon">📊</span><span class="btn-text">Аналитика</span></button>
            <button class="footer-btn" id="shop-btn"><span class="btn-icon">🛒</span><span class="btn-text">Магазин</span></button>
          </div>
        </footer>

        <div class="modal-overlay" id="modal-container">
          <div class="modal-window">
            <header class="modal-header">
              <h3 id="modal-title">Заголовок</h3>
              <button class="modal-close" id="modal-close-btn">&times;</button>
            </header>
            <div class="modal-body" id="modal-content"></div>
          </div>
        </div>
      `;

      mount.appendChild(shell);

      // DOM Elements references
      const usdtEl = shell.querySelector("#usdt-balance");
      const btcEl = shell.querySelector("#btc-balance");
      const tickerEl = shell.querySelector("#btc-rate-ticker");
      const clickPowerEl = shell.querySelector("#click-power");
      const coinBtn = shell.querySelector("#main-coin");
      const floatContainer = shell.querySelector("#float-container");
      const modal = shell.querySelector("#modal-container");
      const modalTitle = shell.querySelector("#modal-title");
      const modalContent = shell.querySelector("#modal-content");
      const modalClose = shell.querySelector("#modal-close-btn");

      function updateUI() {
        usdtEl.textContent = `${state.usdt.toFixed(2)} USDT`;
        btcEl.textContent = `${state.btc.toFixed(8)} BTC`;
        clickPowerEl.textContent = `Доход за клик: +${getClickIncome().toFixed(2)} USDT (Мультипликатор: x${getIncomeMultiplier().toFixed(2)})`;
      }

      // Floating text effect
      function spawnFloatText(text, x, y) {
        const span = document.createElement("span");
        span.className = "float-text";
        span.textContent = text;
        span.style.left = `${x}px`;
        span.style.top = `${y}px`;
        floatContainer.appendChild(span);
        setTimeout(() => span.remove(), 1000);
      }
      
      // Событие клика по монете (Исправлено отображение всплывающего текста)
      coinBtn.addEventListener("click", (e) => {
        playSound('click');
        triggerHaptic();
        const income = getClickIncome();
        state.usdt += income;
        state.totalClicks += 1;
        updateUI();
        saveState();

        const rect = coinBtn.getBoundingClientRect();
        const x = e.clientX - rect.left + Math.random() * 20 - 10;
        const y = e.clientY - rect.top;
        spawnFloatText(`+${income.toFixed(1)}$`, x, y);
      });

      // Логика модальных окон
      function openModal(title, htmlContent) {
        modalTitle.textContent = title;
        modalContent.innerHTML = htmlContent;
        modal.classList.add("active");
        setupModalListeners();
      }

      modalClose.addEventListener("click", () => modal.classList.remove("active"));

      function setupModalListeners() {
        // Улучшение клика
        const buyUpgrade = modalContent.querySelector("#buy-click-up");
        if (buyUpgrade) {
          buyUpgrade.addEventListener("click", () => {
            const cost = getUpgradeCost(state.clickLevel);
            if (state.usdt >= cost) {
              state.usdt -= cost;
              state.clickLevel += 1;
              playSound('buy');
              updateUI();
              saveState();
              shopMenu();
            } else { playSound('error'); }
          });
        }

        // Улучшение автомайнинга
        const buyAuto = modalContent.querySelector("#buy-auto-up");
        if (buyAuto) {
          buyAuto.addEventListener("click", () => {
            const cost = getAutoMineCost(state.autoMineLevel);
            if (state.usdt >= cost) {
              state.usdt -= cost;
              state.autoMineLevel += 1;
              playSound('buy');
              updateUI();
              saveState();
              shopMenu();
            } else { playSound('error'); }
          });
        }

        // Покупка Биткоинов
        const buyBtc = modalContent.querySelector("#buy-btc-btn");
        if (buyBtc) {
          buyBtc.addEventListener("click", () => {
            const amount = parseFloat(modalContent.querySelector("#btc-amount-input").value) || 0;
            const cost = amount * btcRate;
            if (amount > 0 && state.usdt >= cost) {
              state.usdt -= cost;
              state.btc += amount;
              playSound('buy');
              updateUI();
              saveState();
              shopMenu();
            } else { playSound('error'); }
          });
        }

        // Забрать ежедневную награду
        const claimDaily = modalContent.querySelector("#claim-daily-btn");
        if (claimDaily) {
          claimDaily.addEventListener("click", () => {
            const now = Date.now();
            if (now - state.lastDailyRewardTime >= 60000) { 
              state.usdt += dailyRewardUsdt;
              state.btc += dailyRewardBtc;
              state.lastDailyRewardTime = now;
              playSound('claim');
              updateUI();
              saveState();
              dailyMenu();
            } else { playSound('error'); }
          });
        }

        // Получение наград за достижения (Исправлены кавычки в ID)
        ACHIEVEMENTS.forEach(ach => {
          const btn = modalContent.querySelector(`#claim-ach-${ach.id}`);
          if (btn) {
            btn.addEventListener("click", () => {
              state.usdt += ach.rewardUsdt;
              state.btc += ach.rewardBtc;
              state.achievementsClaimed.push(ach.id);
              playSound('claim');
              updateUI();
              saveState();
              achievementsMenu();
            });
          }
        });
      }

      // Меню Магазина (Исправлен синтаксис строк)
      function shopMenu() {
        const clickCost = getUpgradeCost(state.clickLevel);
        const autoCost = getAutoMineCost(state.autoMineLevel);
        openModal("Магазин и улучшения", `
          <div class="shop-item"> 
            <div><strong>Улучшить клик (Ур. ${state.clickLevel})</strong><br><small>Доход: +${(state.clickLevel * initialUsdtPerClick).toFixed(1)} USDT</small></div> 
            <button class="shop-buy-btn" id="buy-click-up" ${state.usdt < clickCost ? 'disabled' : ''}>${clickCost} USDT</button> 
          </div> 
          <div class="shop-item"> 
            <div><strong>Автомайнинг (Ур. ${state.autoMineLevel})</strong><br><small>Пассив: +${getAutoMineIncome().toFixed(1)}/сек</small></div> 
            <button class="shop-buy-btn" id="buy-auto-up" ${state.usdt < autoCost ? 'disabled' : ''}>${autoCost} USDT</button> 
          </div> 
          <div class="shop-crypto"> 
            <h4>Купить Биткоины</h4> 
            <div class="crypto-input-group"> 
              <input type="number" id="btc-amount-input" step="0.001" placeholder="Количество BTC" value="0.01"> 
              <button class="shop-buy-btn" id="buy-btc-btn">Купить</button> 
            </div> 
          </div>
        `);
      }

      // Меню Ежедневной награды (Исправлены условия и кнопки)
      function dailyMenu() {
        const now = Date.now();
        const timePassed = now - state.lastDailyRewardTime;
        const available = timePassed >= 60000;
        const timeLeft = Math.max(0, Math.ceil((60000 - timePassed) / 1000));
        openModal("Ежедневная награда", `
          <div style="text-align:center; padding:15px;"> 
            <p>Ваш ежедневный бонус за активность на рынке:</p> 
            <h2 style="color:#2ecc71">+${dailyRewardUsdt} USDT <br> +${dailyRewardBtc} BTC</h2> 
            ${available ? 
              `<button class="claim-large-btn" id="claim-daily-btn">Забрать награду</button>` : 
              `<button class="claim-large-btn" disabled>Доступно через ${timeLeft}с</button>`
            } 
          </div>
        `);
      }

      // Меню графиков аналитики (Исправлен map отрисовки колонок)
      function marketMenu() {
        openModal("Аналитика рынка", `
          <div style="padding:10px;"> 
            <p>Текущий курс: <strong style="color:#f1c40f">$${btcRate.toLocaleString()}</strong></p> 
            <div class="market-chart"> 
              ${priceHistory.map(price => `<div class="chart-bar" style="height:${Math.min(100, Math.max(10, (price - 50000) / 300))}px" title="$${price.toLocaleString()}"></div>`).join('')} 
            </div> 
            <p style="font-size:11px; color:#888; text-align:center; margin-top:5px;">Обновление графиков в реальном времени каждые ${marketUpdateInterval} сек.</p> 
          </div>
        `);
      }

      // Меню достижений (Исправлен синтаксис сборки шаблона)
      function achievementsMenu() {
        let html = '<div class="achievements-list">';
        ACHIEVEMENTS.forEach(ach => {
          let current = 0;
          if (ach.targetType === 'clicks') current = state.totalClicks;
          if (ach.targetType === 'usdt') current = state.usdt;
          if (ach.targetType === 'btc') current = state.btc;
          if (ach.targetType === 'automine') current = state.autoMineLevel;
          const isDone = current >= ach.targetValue;
          const isClaimed = state.achievementsClaimed.includes(ach.id);
          html += `
            <div class="ach-item ${isClaimed ? 'claimed' : ''}"> 
              <div> 
                <strong>${ach.title}</strong><br><small>${ach.desc} (${Math.min(current, ach.targetValue)}/${ach.targetValue})</small> 
              </div> 
              <div> 
                ${isClaimed ? '<span>Получено</span>' : isDone ? `<button class="ach-claim-btn" id="claim-ach-${ach.id}">Взять</button>` : '<span>В процессе</span>'} 
              </div> 
            </div>`;
        });
        html += '</div>';
        openModal("Достижения", html);
      }

      // Привязка действий к кнопкам нижнего меню
      shell.querySelector("#shop-btn").addEventListener("click", shopMenu);
      shell.querySelector("#daily-btn").addEventListener("click", dailyMenu);
      shell.querySelector("#market-btn").addEventListener("click", marketMenu);
      shell.querySelector("#achievements-btn").addEventListener("click", achievementsMenu);

      shell.querySelector("#reset-btn").addEventListener("click", () => {
        if (confirm("Вы уверены, что хотите сбросить весь прогресс?")) {
          state = { usdt: 0, btc: 0, clickLevel: 1, autoMineLevel: 0, totalClicks: 0, lastDailyRewardTime: 0, achievementsClaimed: [], rebirths: 0 };
          updateUI();
          saveState();
        }
      });

      // Цикл пассивного дохода (Автомайнинг)
      const passiveInterval = setInterval(() => {
        const passiveIncome = getAutoMineIncome() / 10; 
        if (passiveIncome > 0) {
          state.usdt += passiveIncome;
          updateUI();
        }
      }, 100);

      // Изменение курса рынка
      const marketInterval = setInterval(() => {
        const volatility = 0.02; 
        const changePercent = 1 + (Math.random() - 0.495) * volatility;
        btcRate = Math.round(btcRate * changePercent);
        priceHistory.push(btcRate);
        if (priceHistory.length > 20) priceHistory.shift();
        tickerEl.innerHTML = `$${btcRate.toLocaleString()} <span class="rate-arrow ${changePercent >= 1 ? 'up' : 'down'}">${changePercent >= 1 ? '▲' : '▼'}</span>`;
      }, marketUpdateInterval * 1000);

      cleanup = () => {
        clearInterval(passiveInterval);
        clearInterval(marketInterval);
      };

      updateUI();
      if (ready) ready();
    },
    destroy() {
      cleanup();
    }
  };
}
