"""Fixed public errors only; provider exception text never crosses the boundary."""
try:
    from .provider_rebase.revision import SAFE_ERRORS
except ImportError:
    from provider_rebase.revision import SAFE_ERRORS

PUBLIC_ERRORS = SAFE_ERRORS | frozenset({
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


def error_label(code):
    return {
        'SAME_PROVIDER_REVISION': '同一行情源历史价格发生修订，已暂停正式更新，需要审阅。',
        'UNIT_CONTRACT_INCOMPLETE': '历史修订候选的单位证据尚未完成，已暂停正式更新。',
        'REVISION_SUSPECTED': '完整历史探测存在缺口，需要复核。',
        'REVISION_PROBE_FAILED': '完整历史探测失败，未确认源数据。',
        'PROVIDER_SWITCH': '行情来源与正式历史不一致，需要复核来源。',
        'PROVIDER_REBASE_REQUIRED': '历史混合来源需要独立迁移审批。',
        'SOURCE_CONTRACT_MISMATCH': '来源、单位或精度契约不一致，已停止更新。',
        'VERSION_CONFLICT': '版本冲突，未覆盖当前有效行情。',
        'provider_or_pipeline_failure': '行情来源暂不可用，请稍后重试。',
        'pipeline_failure': '执行端处理异常，请检查执行端。',
    }.get(public_error(code), '行情校验未通过，已暂停正式更新。')
