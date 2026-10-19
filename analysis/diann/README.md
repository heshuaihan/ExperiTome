# DIA-NN 主报告初步筛选与设置记录 · v0.2.0

本工具针对DIA-NN输出的主报告，不分析仪器原始文件。无物种、实验分组或富集名单假设。


## 先跑DIA-NN，再filter

1. 从官网获取最新稳定版。按仪器输入Thermo .raw、Bruker .d或Sciex .wiff；另支持.mzML/.dia，读取依赖与系统限制以官网为准。实际记录保留具体软件版本。
2. 普通总蛋白一般开启RT-dependent归一化；IP/亲和富集按设计优先关闭并评估。线程按本机CPU、内存与其他任务选择，不固定20。
3. timsTOF的MS1/MS2 accuracy可从15/15 ppm开始，电荷2–4是常用起点（官网明确最低2，上限按采集方法）；其他仪器不要照搬。0代表自动优化。m/z、酶切与修饰跟实际采集/制备一致。
4. 少量代表性run试跑并核定正式设置；完成全量搜索，保存report.parquet、pipeline与日志后，再运行下面的报告filter。

本包不包含DIA-NN软件，也不替你执行原始数据搜索。参数选择说明核对日期2026-10-19，官方入口：https://github.com/vdemichev/DiaNN 。

## 安装与运行

已验证环境：Python 3.13.4、pandas 2.3.3、pyarrow 24.0.0。

```powershell
python -m pip install -r requirements.txt
python diann_filter.py --input example_report.csv --config filter.basic.json --output-dir example_basic
python diann_filter.py --input example_report.csv --config filter.extended.example.json --output-dir example_extended
python diann_filter.py --input "D:/data/report.parquet" --config filter.basic.json --output-dir "D:/data/qc_run01"
python diann_settings.py --log "D:/data/report.log.txt" --output "D:/data/settings-record.json"
python -m unittest -v test_diann.py
```

输出目录/记录文件必须是新路径，不覆盖已有文件。示例是人工合成数据，不能代表实际检出水平。CSV/TSV和Parquet需具有主报告列结构；蛋白表达矩阵不能代替主报告。整表读入内存，不是超大数据的分块实现。

## 配置与输出

`filter.basic.json`是可编辑的起点。`filter.extended.example.json`增加Peptidoform/QuantUMS质量、cRAP字面标签和2种不同Stripped.Sequence条件，按分析模式评估后选择。所有数值条件取交集；支持<、<=、>、>=。严格不等号排除等于阈值的行；过滤列的缺失、非数值、无穷值不通过；缺列报错。

污染规则区分大小写，混合蛋白组任一成员含标签即删除整行。minimum_distinct_peptides为0时关闭；protein_group范围跨整份过滤后报告累计序列，run_protein_group范围则每个run独立计数；不等于蛋白特异肽条件。

输出filtered_report.parquet、run_counts.csv、audit.json、config.used.json。审计保留顺序过滤计数及文件哈希；顺序删除量不能当成各条件独立效应。输入所有列与保留行的原值不改写；零值和缺失保留。PG.MaxLFQ不会重算，同一蛋白组在多条前体行重复的量不能直接相加。本工具不生成生物重复矩阵，不做归一化、补值、差异检验。

默认工作流意图：普通总蛋白DIA-NN采用RT-dependent归一化，IP/亲和富集另定策略；确认已执行后，下游不再额外归一化；只有数据评估支持时才追加并记录依据。实际日志状态单独记录：--no-norm表示关闭；--rt-profiling是谱库RT/IM profiling，不证明强度归一化。Normalised/MaxLFQ列名也不足以判断是否已归一化。

日志提取仅解析单行显式CLI参数，保留重复flag；不推断缺席参数的默认值、定量模式或运行成功。输出可能含私人路径和run名称；分享前检查。settings-record.template.json用于补全pipeline、数据库版本/哈希及归一化事实与意图。非常规日志格式和路径中的flag式片段需人工核查。

本版面向常规非多重标记蛋白组；plexDIA、PTM位点、DDA及其他版本需重新核对列含义与规则。新阈值应先检查保留量和质量，不等同于统计或实验验证。

## 来源与许可

官方文档：https://github.com/vdemichev/DiaNN （核对日期2026-10-19；在线内容随版本更新）。本地提供的DIA-NN 2.6.0日志用来验证解析，不随工具包分发。工具包无私人研究数据，也不含DIA-NN软件。

Copyright (c) 2026 Shuaihan He。原创Python代码MIT（MIT.txt）；原创说明、配置注释及人工合成示例CC BY 4.0（CC-BY-4.0.txt）；第三方依赖采用其自身许可。

版本记录：v0.2.0调整先分析再filter的使用顺序与参数选择；筛选算法不变。v0.1.0包保留，避免覆盖旧交付。
