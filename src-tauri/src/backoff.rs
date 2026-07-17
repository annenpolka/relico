/// APIポーリングの指数バックオフ。返す遅延は常に[base, max]に収まる
#[derive(Debug, Clone)]
pub struct Backoff {
    base: u64,
    max: u64,
    current: u64,
}

impl Backoff {
    pub fn new(base_secs: u64, max_secs: u64) -> Self {
        Self {
            base: base_secs,
            max: max_secs.max(base_secs),
            current: base_secs,
        }
    }

    /// 失敗時: 次の遅延(秒)を返す。倍々でmaxまで
    pub fn on_failure(&mut self) -> u64 {
        todo!("SPEC: POL-001")
    }

    /// 成功時: baseにリセットして返す
    pub fn on_success(&mut self) -> u64 {
        todo!("SPEC: POL-001")
    }
}
