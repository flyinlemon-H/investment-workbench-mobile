"""Local preflight and console adapter. The existing Worker owns all execution."""
from __future__ import annotations
import argparse
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ENVIRONMENTS = {'Production': 'fntslvdxnupmdljnadec', 'Test': 'lblyapnsngqnjimgskkp'}
MESSAGES = {
    'python': '未找到可用 Python（需要 Python 3.10 或更高版本）。',
    'worker': 'Worker 程序文件不存在，请重新安装或恢复工作台文件。',
    'source': '行情数据目录不可用，请重新运行快捷方式设置。',
    'state': 'Worker 本地状态目录不可用，或位于 Git / OneDrive 内。',
    'unpaired': '执行端尚未完成授权配对。请先在手机：研究资料 → 技术面 → 执行端设置 → 生成执行端授权。',
    'credential': '执行端授权无效，请重新配对。',
    'expired': '执行端授权已失效，请重新生成授权。',
    'environment': '执行端授权与预期环境不一致，请重新配对；未连接远端。',
    'dependencies': 'Worker 依赖无法加载，请检查设置中所选 Python 的行情依赖。',
    'busy': '投资分析 Worker 已在运行，请使用已打开的窗口。',
    'startup': 'Worker 启动失败，请检查本地配置或重新运行快捷方式设置。',
}


class PreflightError(Exception):
    pass


def safe_state_dir(directory, root=ROOT):
    directory=Path(directory).resolve()
    forbidden=[Path(root).resolve()]
    for key in ('OneDrive','OneDriveConsumer','OneDriveCommercial'):
        if os.environ.get(key):forbidden.append(Path(os.environ[key]).resolve())
    if any(directory.is_relative_to(p) for p in forbidden):raise PreflightError('state')
    if any((p/'.git').exists() for p in (directory,*directory.parents)):raise PreflightError('state')
    if any(p.lower().startswith('onedrive') for p in directory.parts):raise PreflightError('state')
    try:
        directory.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryFile(dir=directory):pass
    except OSError:raise PreflightError('state') from None
    return directory


def preflight(source, directory, environment, require_pair=True, root=ROOT):
    if sys.version_info<(3,10):raise PreflightError('python')
    if not (root/'scripts/market_data_worker.py').is_file():raise PreflightError('worker')
    if not (source/'src/market_data/updater.py').is_file() or not (source/'src/market_data/provider.py').is_file():raise PreflightError('source')
    directory=safe_state_dir(directory,root)
    try:
        worker=importlib.import_module('market_data_worker') if __package__ in (None,'') else importlib.import_module('.market_data_worker',__package__)
        worker.load_source_updater(source)
        provider=importlib.import_module('src.market_data.provider')
        if not callable(provider.ProviderChain) or not callable(provider.is_complete_trade_date):raise ImportError()
    except Exception:raise PreflightError('dependencies') from None
    if require_pair:
        path=directory/'market-worker.bin'
        if not path.is_file():raise PreflightError('unpaired')
        try:credential=json.loads(worker.protect(path.read_bytes(),decrypt=True))
        except Exception:raise PreflightError('credential') from None
        try:worker.Registry(credential)
        except Exception as error:raise PreflightError('expired' if str(error)=='worker_credential_expired' else 'credential') from None
        if credential['projectRef']!=ENVIRONMENTS[environment]:raise PreflightError('environment')
    return worker


class Console:
    def __init__(self):self.previous=None
    def __call__(self,event):
        status=event.get('status')
        symbol=str(event.get('symbol') or '')
        # Render only fixed local labels and validated symbols/dates; never raw errors.
        import re
        if not re.fullmatch(r'(?:\d{6}\.(?:SS|SZ)|\d{4,5}\.HK)',symbol):symbol='当前标的'
        if status=='waiting':message='已连接，等待手机行情任务……'
        elif status=='running':message=f'正在更新 {symbol}'
        elif status=='succeeded':
            day=str(event.get('latestCompleteBarAfter') or '')
            day=day if re.fullmatch(r'\d{4}-\d{2}-\d{2}',day) else '待确认'
            message=f'{symbol} 更新完成\n最新完整日：{day}'
        elif status=='failed':
            try:
                from .market_worker_errors import error_label
            except ImportError:
                from market_worker_errors import error_label
            saved='隔离候选已保存在本执行端，请导出给维护人员审阅。' if event.get('candidateSaved') is True else '本事件未确认隔离候选已保存，请在执行端核对。'
            message=f"{symbol} {error_label(event.get('error'))}\n上一份有效结果保留。{saved}"
        elif status=='unauthorized':message='执行端授权已失效，请重新生成授权。关闭窗口后运行首次配对。'
        elif status=='connection_or_delivery_error':message='无法连接远端任务服务或提交结果；将重试，未确认结果会保留。'
        elif status=='stopped':message='Worker 已退出。若任务正在处理，请在手机查看租约恢复状态。'
        else:return
        if status not in ('waiting','unauthorized','connection_or_delivery_error') or message!=self.previous:print(message,flush=True)
        self.previous=message


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root',type=Path,required=True)
    parser.add_argument('--state-dir',type=Path,required=True)
    parser.add_argument('--environment',choices=ENVIRONMENTS,default='Production')
    parser.add_argument('--preflight',action='store_true')
    parser.add_argument('--allow-unpaired',action='store_true')
    parser.add_argument('--pair',action='store_true')
    args=parser.parse_args(argv)
    if args.allow_unpaired and not args.preflight:parser.error('--allow-unpaired requires --preflight')
    try:
        worker=preflight(args.source_root.resolve(),args.state_dir,args.environment,not(args.pair or args.allow_unpaired))
        if args.preflight:
            print('本地自检通过（未连接远端）。',flush=True);return 0
        worker_args=['--source-root',str(args.source_root.resolve()),'--state-dir',str(args.state_dir.resolve())]
        if args.pair:
            print('请粘贴手机生成的执行端授权 JSON（输入隐藏），然后按 Enter。',flush=True)
            worker.main(worker_args+['--pair'])
            preflight(args.source_root.resolve(),args.state_dir,args.environment)
            print('授权配对完成；以后双击快捷方式即可启动。请删除明文传输副本。',flush=True)
            return 0
        print(f'环境：{args.environment}\n本地自检通过，正在连接远端任务服务……\n按 Ctrl+C 或关闭窗口退出。',flush=True)
        worker.main(worker_args,notify=Console())
        return 0
    except PreflightError as error:
        print(MESSAGES.get(str(error),MESSAGES['startup']),flush=True)
        return 20 if str(error)=='unpaired' else 1
    except KeyboardInterrupt:
        print('已取消，Worker 未继续运行。',flush=True);return 0
    except OSError as error:
        print(MESSAGES['busy'] if getattr(error,'winerror',None) in (32,33,36) or error.errno in (11,13) else MESSAGES['startup'],flush=True);return 1
    except Exception:
        print(MESSAGES['credential'] if args.pair else MESSAGES['startup'],flush=True);return 1


if __name__=='__main__':raise SystemExit(main())
