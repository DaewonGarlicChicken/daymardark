// =========================================================
// 사고실험 02. 볼츠만 두뇌 (Boltzmann Brain) - 기반 물리 모델
// -----------------------------------------------------------
// 기반 개념:
//   1) 쌍생성/쌍소멸: 진공에서 입자-반입자 쌍이 생겼다가 곧바로 소멸함
//   2) 에너지-시간 불확정성 원리: ΔE · Δt ≥ ħ/2
//      -> 빌려오는 에너지(ΔE)가 클수록, 존재 가능한 시간(Δt)은 짧아짐
//
// createBoltzmannBrainSimulator(...) 는 "진공요동 -> 쌍생성 -> (수명 후) 쌍소멸"을
// 확률적으로 시뮬레이션하는 독립적인 시뮬레이터 인스턴스를 하나 만든다.
// (한 화면에 여러 개의 "진공 포켓"이 동시에 존재할 수 있으므로, 전역 상태 하나가
//  아니라 포켓마다 독립된 인스턴스를 갖도록 팩토리 함수로 만듦)
//
// 극히 드물게, 요동의 규모가 압도적으로 커서 "두뇌 하나가 조립될 만한 에너지"에
// 해당하는 사건(볼츠만 두뇌 사건)도 발생하는데, 이건 별도 규칙이 아니라 같은
// 지수분포의 극단적인 꼬리(tail)일 뿐이다.
//
// [스케일 관련 참고]
//   brainEnergyScale=6, attemptRate=5000 은 물리적으로 정직한 값이 아니라
//   "형태화 단계에서 가끔은 눈에 띄게" 만들기 위한 연출용 스케일이다.
//   이 조합(20초에 약 10만 번 시도)에서 실제로 약 230회 안팎의 볼츠만 두뇌급
//   사건이 발생함을 시뮬레이션으로 확인함 (이론적 기대값: n × e^-6).
//   물리적으로 현실적인 비율(brainEnergyScale >> E0, 예: 1e6 이상)로 두면
//   사실상 절대 발생하지 않는다 - 그게 오히려 정확한 결과다.
// =========================================================

const BOLTZMANN_BRAIN_DEFAULT_CONFIG = {
  hbar: 1,                 // 정규화된 축약 플랑크 상수 (절대값보다 "상대적 크기"가 중요)
  vacuumEnergyScale: 1,    // 보통의 가상입자 쌍이 빌리는 전형적 에너지 규모 (E0)
  brainEnergyScale: 6,     // "두뇌 하나" 조립에 해당하는 에너지 규모 (연출용 스케일: E0의 6배)
  attemptRate: 15,         // 초당 "요동 시도" 횟수 (20초 기준 300번에 맞춘 값)
  startDelay: 10,          // 진공이 된 후 이 시간(초)이 지나야 요동이 시작됨
};

// 지수분포에서 ΔE 하나를 뽑음 (평균 = vacuumEnergyScale)
// -> 대부분은 작은 값(흔한 가상입자 쌍), 아주 드물게 매우 큰 값(두터운 꼬리)
function bbSampleEnergyFluctuation(cfg) {
  return -cfg.vacuumEnergyScale * Math.log(Math.random());
}

// 불확정성 원리: ΔE · Δt = ħ/2  ->  Δt = ħ / (2ΔE)
function bbLifetimeFromEnergy(deltaE, cfg) {
  return cfg.hbar / (2 * deltaE);
}

// 독립된 시뮬레이터 인스턴스 생성 (진공 포켓 하나 당 하나씩 사용)
function createBoltzmannBrainSimulator(configOverrides) {
  const cfg = Object.assign({}, BOLTZMANN_BRAIN_DEFAULT_CONFIG, configOverrides || {});

  let events = [];   // { id, energy, lifetime, spawnTime, isBrainEvent }
  let nextId = 0;
  let attemptAccumulator = 0;
  let startTime = 0;

  function reset(time) {
    events = [];
    nextId = 0;
    attemptAccumulator = 0;
    startTime = time;
  }

  // 매 프레임 업데이트: 쌍생성 시도 + 수명 다 된 쌍소멸 처리
  // 반환값: 이번 프레임에 "새로 생성된" 사건들 (시각화가 즉시 반응할 수 있도록)
  function update(time, deltaTime) {
    // 진공이 된 직후 startDelay 만큼은 요동이 시작되지 않음
    if (time - startTime < cfg.startDelay) {
      return [];
    }

    attemptAccumulator += deltaTime * cfg.attemptRate;
    const attempts = Math.floor(attemptAccumulator);
    attemptAccumulator -= attempts;

    const newlySpawned = [];
    for (let i = 0; i < attempts; i++) {
      const energy = bbSampleEnergyFluctuation(cfg);
      const lifetime = bbLifetimeFromEnergy(energy, cfg);
      const event = {
        id: nextId++,
        energy,
        lifetime,
        spawnTime: time,
        isBrainEvent: energy >= cfg.brainEnergyScale,
      };
      events.push(event);
      newlySpawned.push(event);
    }

    events = events.filter((e) => time - e.spawnTime < e.lifetime);

    return newlySpawned;
  }

  function getActiveEvents() {
    return events;
  }

  return { config: cfg, reset, update, getActiveEvents };
}
