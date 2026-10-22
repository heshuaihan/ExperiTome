# ExperiTome

![ExperiTome — Built on experience. Made for discovery. Protocols, Analysis and Data.](assets/experitome-hero.png)

**源于实践，助力发现。**

## 网页阅读

**[打开 ExperiTome 网站 →](https://heshuaihan.github.io/ExperiTome/)**

[实验方法](https://heshuaihan.github.io/ExperiTome/protocols/index.html) · [分析流程](https://heshuaihan.github.io/ExperiTome/analysis/index.html) · [配套数据](https://heshuaihan.github.io/ExperiTome/data/index.html) · [项目介绍](https://heshuaihan.github.io/ExperiTome/about.html) · [发展路线](https://heshuaihan.github.io/ExperiTome/roadmap.html)

浏览实验路线、操作步骤、试剂与配液，使用目录导航和全文搜索查找所需内容。

ExperiTome is an open-source project for organizing research experience, experimental protocols, data resources, and analysis workflows into a connected, traceable knowledge library. Beginning with life-science methods, it aims to help researchers build and maintain their own reusable research libraries. Chinese-first documentation; English support planned.

ExperiTome 从实际研究经验出发，连接实验方法、数据资源与分析流程，建设可追溯、可复用的研究知识库，并逐步探索经验交流、AI 协同检索与方法整理工具。

## Why ExperiTome

**Experi + tome** connects experiment and experience with an organized body of knowledge.

Experi 取自 experiment，也呼应 experience；tome 表达经过整理、持续积累的知识。项目重视实际使用后的细节、体验与反馈，帮助研究者保存并复用实验方法、分析过程及其配套材料。

- **Built from experience:** preserve practical details, context and observed limitations; distinguish hands-on experience from literature and manufacturer guidance.
- **Connected through exchange:** develop methods through attributed, version-specific feedback.
- **Discover with AI:** explore source-linked retrieval and organization, with researcher review of extracted and missing information.

The current release is a static methods library. A dedicated community platform, AI-assisted discovery and a reusable skill are planned; they are not available services in this release.

## Contents

| Collection | Current scope |
|---|---|
| Protocols | 8 Chinese detailed modules, 2 C. elegans proteomics/TurboID routes; methods remain drafts |
| Materials | 104 material identities, including 30 core materials; buffers and instrument settings |
| Analysis | 6 draft guides: DIA-NN settings/filter, routine workflows, package choices, reusable practices and plot style; generic starter code and synthetic example |
| Data | Planned; example inputs, processed results and supplementary tables; no released dataset collection yet |

## Author

**Shuaihan He（何帅涵）**, sole maintainer. PhD student, Bioscience and Biomedical Engineering Thrust; Brain and Intelligence Research Institute; The Hong Kong University of Science and Technology (Guangzhou).

Personal project; affiliation does not imply institutional endorsement. See [AUTHORS.md](AUTHORS.md). Source publications and contributions to individual entries remain credited separately.

## Local use

Install Quarto 1.10.18 and Python 3. Run `quarto render`, then open `_site/index.html`. The current site is static; it does not provide a running database server or remote analysis service.

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
