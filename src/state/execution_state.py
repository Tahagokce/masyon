import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class ExecutionState:
    run_id: str = field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ_") + uuid.uuid4().hex[:8])
    generated_values: dict = field(default_factory=dict)
    summary: str = ""
    pages: list = field(default_factory=list)
    metrics: dict = field(default_factory=lambda: {"geminiRequests": 0, "inputTokens": 0, "outputTokens": 0,
                                                 "thoughtTokens": 0, "browserToolCalls": 0})

    def generate(self, name: str, prefix: str = "AUTO", value: str | None = None) -> str:
        if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{0,47}", name):
            raise ValueError("Value name must be a short identifier")
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{0,15}", prefix):
            raise ValueError("Prefix must use uppercase letters, digits or underscores")
        if value is not None and (not isinstance(value, str) or not value or len(value) > 160):
            raise ValueError("Explicit generated value must be a nonempty string of at most 160 characters")
        if name in self.generated_values and value is not None and self.generated_values[name] != value:
            raise ValueError("A generated value cannot be changed later in the case")
        if name not in self.generated_values:
            self.generated_values[name] = value if value is not None else f"{prefix}_{self.run_id}_{len(self.generated_values) + 1:03d}"
        return self.generated_values[name]
