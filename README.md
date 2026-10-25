# ExperiTome

![ExperiTome — Built on experience. Made for discovery. Protocols, Data and Analysis.](assets/experitome-hero.png)

**源于实践，助力发现。**

## 网页阅读

**[打开 ExperiTome 网站 →](https://heshuaihan.github.io/ExperiTome/)**

[实验方法](https://heshuaihan.github.io/ExperiTome/protocols/index.html) · [主站 Data 说明](https://heshuaihan.github.io/ExperiTome/data/index.html) · [分析流程](https://heshuaihan.github.io/ExperiTome/analysis/index.html) · [项目介绍](https://heshuaihan.github.io/ExperiTome/about.html) · [发展路线](https://heshuaihan.github.io/ExperiTome/roadmap.html)

**[打开 ExperiAtlas 在线工作台 →](https://heshuaihan.github.io/ExperiTome/atlas/)**

浏览实验路线、操作步骤、试剂与配液，使用目录导航和全文搜索查找所需内容。

ExperiTome is an open-source project for organizing research experience, experimental protocols, data resources, and analysis workflows into a connected, traceable knowledge library. ExperiAtlas is a separate public v0.2.1 service for cross-species lookup and selected expression resources, based on fixed versioned snapshots. Main-site v0.4.0 includes ExperiAnalysis 0.2.0 with a static browser workbench and a licensed local companion download; its source repository remains private. The browser workbench processes selected files in the current browser tab without uploading them to a remote service. Chinese-first documentation; English support planned.

ExperiTome 从实际研究经验出发，连接实验方法、ExperiAtlas 数据入口与分析流程，建设可追溯、可复用的研究知识库，并逐步探索经验交流、AI 协同检索与方法整理工具。

## Why ExperiTome

**Experi + tome** connects experiment and experience with an organized body of knowledge.

Experi 取自 experiment，也呼应 experience；tome 表达经过整理、持续积累的知识。项目重视实际使用后的细节、体验与反馈，帮助研究者保存并复用实验方法、分析过程及其配套材料。

- **Built from experience:** preserve practical details, context and observed limitations; distinguish hands-on experience from literature and manufacturer guidance.
- **Connected through exchange:** develop methods through attributed, version-specific feedback.
- **Discover with AI:** explore source-linked retrieval and organization, with researcher review of extracted and missing information.

The ExperiTome site is a static knowledge library. ExperiAtlas v0.2.1 is available separately as a public service using fixed snapshots. A dedicated community platform, AI-assisted discovery and a reusable skill are planned; they are not available services in this release.

## Contents

| Collection | Current scope |
|---|---|
| Protocols | 8 Chinese detailed modules, 2 C. elegans proteomics/TurboID routes; methods remain drafts |
| Data | Public ExperiAtlas v0.2.1: fixed-snapshot cross-species identity, homology and selected expression resources; source versions and reuse limits are documented |
| Analysis | 6 draft guides plus the ExperiAnalysis 0.2.0 browser workbench and local companion; browser limit of 250 MiB per file and 5 million rows per DIA-NN report |
| Materials | 104 material identities, including 30 core materials; buffers and instrument settings |

## Author

**Shuaihan He（何帅涵）**, sole maintainer. PhD student, Bioscience and Biomedical Engineering Thrust; Brain and Intelligence Research Institute; The Hong Kong University of Science and Technology (Guangzhou). [Author profile](profile/index.qmd).

Personal project; affiliation does not imply institutional endorsement. See [AUTHORS.md](AUTHORS.md). Source publications and contributions to individual entries remain credited separately.

## Analysis workbench

For the v0.4.0 release, the browser workbench will be at [ExperiAnalysis](analysis/app/index.html). Browser input is limited to 250 MiB per file and 5 million rows per DIA-NN report. For larger DIA-NN reports, XIC tables, native R MinProb/kNN imputation, or ranked GSEA, [download the ExperiAnalysis 0.2.0 local companion](https://github.com/heshuaihan/ExperiAnalysis/releases/download/experianalysis-v0.2.0/ExperiAnalysis-0.2.0-local.zip).

## Local use

Install Quarto 1.10.18 and Python 3. Run `quarto render`, then open `_site/index.html`. The ExperiTome site is static; ExperiAtlas is accessed separately through its [public workbench](https://heshuaihan.github.io/ExperiTome/atlas/) and [Data guide](https://heshuaihan.github.io/ExperiTome/data/index.html). Personal measurements and private research records are not part of this package.

## GitHub Pages

The source package includes `.github/workflows/publish.yml`. In repository Settings → Pages select GitHub Actions. Updates to main and manual workflow runs build, check and deploy; pull requests build and check only. Repository: https://github.com/heshuaihan/ExperiTome. Website target: https://heshuaihan.github.io/ExperiTome/.

Keep `.github/` and the supplied `.gitignore`; do not upload the rendered `_site/`, `.quarto/`, private manuscripts, original reports, third-party full-text PDFs, raw datasets or internal snapshots.

## Maintenance and citation

Chinese detailed modules are the current editing source. Method versions, dataset/analysis versions, and site versions are tracked separately. See review/versions/ and review/readiness.qmd. Cite original methods and data sources; cite this repository for its original documentation/curation using [CITATION.cff](CITATION.cff).

## License

- Original documentation and curation annotations: **CC BY 4.0**.
- Original software, styles and build configuration: **MIT**.
- Underlying datasets: their own explicitly recorded licenses.
- Third-party material: original authors' rights and licenses.

These licenses cover different material types, not alternative licensing choices for the same item. See [LICENSE](LICENSE), [license texts](LICENSES/) and [contribution guidance](CONTRIBUTING.md).
