pub mod runner;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    Normal,
    Plan,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    AllowOnce,
    AllowSession,
    AllowAlways,
    Deny,
}

impl AgentMode {
    /// En modo `/plan` solo se permiten operaciones de solo lectura.
    pub fn allows_writes(self) -> bool {
        matches!(self, AgentMode::Normal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modo_plan_bloquea_escrituras() {
        assert!(!AgentMode::Plan.allows_writes());
        assert!(AgentMode::Normal.allows_writes());
    }
}
