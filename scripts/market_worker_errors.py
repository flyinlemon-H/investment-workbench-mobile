"""Fixed public errors only; provider exception text never crosses the boundary."""
try:
    from .provider_rebase.revision import SAFE_ERRORS
except ImportError:
    from provider_rebase.revision import SAFE_ERRORS

DAILY_ERRORS = frozenset({'DAILY_POLICY_DISABLED','DAILY_PROTOCOL_MISMATCH','DAILY_BASELINE_INVALID',
    'DAILY_FACTS_MISMATCH','DAILY_TRUSTED_RECEIPT_REQUIRED','DUPLICATE_SUBMISSION_MISMATCH',
    'RAW_PROVENANCE_REQUIRED','RAW_OUTPUT_MISMATCH','RAW_SYMBOL_MISMATCH','RAW_QUOTE_CHANGED',
    'REPEAT_OBSERVATION_REQUIRED','UNSTABLE_PROVIDER_OBSERVATION','HISTORY_DATE_SET_CHANGED',
    'NON_FLOAT32_ADJCLOSE_CHANGE','ADJCLOSE_STEP_EXCEEDED','PRICE_DELTA_EXCEEDED',
    'UNCALIBRATED_REVISION_RANGE','TECHNICAL_DECISION_BOUNDARY_CHANGED','TECHNICAL_NUMERIC_BOUND_EXCEEDED',
    'PROVENANCE_INVALID','INVALID_HISTORY','ACTIVE_MIGRATION_CONFLICT','ACTIVE_TASK_CONFLICT',
    'QUANTITY_REVISION','UNCALIBRATED_SCOPE','RAW_WINDOW_MISMATCH',
    'provider_timeout','provider_network_error','provider_empty','provider_parse_failure'})
PUBLIC_ERRORS = SAFE_ERRORS | DAILY_ERRORS | frozenset({
    'provider_mismatch', 'adjustment_mismatch', 'adjustment_revision_requires_full_rebuild',
    'invalid_ohlc', 'invalid_bar_order', 'invalid_history', 'provider_or_pipeline_failure',
    'unaligned_result', 'pipeline_failure'})


def public_error(error):
    value = str(error)
    return value if value in PUBLIC_ERRORS else 'pipeline_failure'


class PipelineFailure(ValueError):
    def __init__(self, code, candidate_saved=False):
        super().__init__(public_error(code))
        self.candidate_saved = candidate_saved is True


class DailyRejected(ValueError):
    """A fixed, non-secret server rejection. Network ambiguity keeps the outbox."""


def error_label(code):
    if code in DAILY_ERRORS:
        return {
            'DAILY_POLICY_DISABLED':'受信任日更通路尚未启用，上一份行情保持不变。',
            'RAW_QUOTE_CHANGED':'原始报价发生变化，超出微修订范围，需要复核。',
            'QUANTITY_REVISION':'成交量或成交额发生变化，需要复核。',
            'REPEAT_OBSERVATION_REQUIRED':'缺少两次独立行情观察，未写入。',
            'UNSTABLE_PROVIDER_OBSERVATION':'两次行情观察不稳定，请稍后重试。',
            'PRICE_DELTA_EXCEEDED':'历史价格变化超出已验证范围，需要复核。',
            'ADJCLOSE_STEP_EXCEEDED':'复权价格变化超出已验证范围，需要复核。',
            'TECHNICAL_DECISION_BOUNDARY_CHANGED':'历史修订改变了技术信号，需要复核。',
            'HISTORY_DATE_SET_CHANGED':'历史日期缺失或变化，已保留原行情。',
            'provider_timeout':'行情源响应超时，请稍后重试。',
            'provider_network_error':'无法连接行情源，请检查网络。',
        }.get(code,'日更校验未通过（'+code+'），上一份有效行情保持不变。')
    return {
        'SAME_PROVIDER_REVISION': '同一行情源历史价格发生修订，已暂停正式更新，需要审阅。',
        'UNIT_CONTRACT_INCOMPLETE': '历史修订候选的单位证据校验未通过，已暂停正式更新。',
        'REVISION_SUSPECTED': '完整历史探测存在缺口，需要复核。',
        'REVISION_PROBE_FAILED': '完整历史探测失败，未确认源数据。',
        'PROVIDER_SWITCH': '行情来源与正式历史不一致，需要复核来源。',
        'PROVIDER_REBASE_REQUIRED': '历史混合来源需要独立迁移审批。',
        'SOURCE_CONTRACT_MISMATCH': '来源、单位或精度契约不一致，已停止更新。',
        'VERSION_CONFLICT': '版本冲突，未覆盖当前有效行情。',
        'provider_or_pipeline_failure': '行情来源暂不可用，请稍后重试。',
        'pipeline_failure': '执行端处理异常，请检查执行端。',
    }.get(public_error(code), '行情校验未通过，已暂停正式更新。')
