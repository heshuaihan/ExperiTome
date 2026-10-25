#!/usr/bin/env python3
"""Generate the bilingual public author page and downloadable CV from project.json."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "project.json"
PAGE = ROOT / "profile" / "index.qmd"
CV = ROOT / "profile" / "public-cv.md"

FORBIDDEN_KEYS = re.compile(
    r"phone|mobile|cellphone|address|student.?id|government.?id|personal.?id|"
    r"national.?id|passport|identity.?document|identity.?number|id.?number|"
    r"transcript|gpa|class.?rank|certificate|portrait|photo|scan|attachment",
    re.IGNORECASE,
)
PHONE_VALUE = re.compile(r"(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d{2}[\s-]?\d{4}[\s-]?\d{4}(?!\d)")
EMAIL_VALUE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
IDENTITY_VALUE = re.compile(r"(?<!\d)(?:\d{15}|\d{17}[\dXx])(?!\d)")


def markdown(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ").strip()


def link(label: str, url: str) -> str:
    if not url.startswith("https://") or any(char in url for char in "()<>\n\r"):
        raise ValueError(f"Only plain HTTPS links are allowed in the public profile: {url}")
    return f"[{markdown(label)}]({url})"


def inspect_private_fields(value: Any, trail: str = "maintainer.public_profile") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if FORBIDDEN_KEYS.search(str(key)):
                raise ValueError(f"Refusing to generate public output from private field {trail}.{key}")
            inspect_private_fields(child, f"{trail}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            inspect_private_fields(child, f"{trail}[{index}]")
    elif isinstance(value, str):
        if PHONE_VALUE.search(value) or EMAIL_VALUE.search(value) or IDENTITY_VALUE.search(value):
            raise ValueError(f"Refusing to generate public output from a phone or email value at {trail}")


def validate(project: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    maintainer = project.get("maintainer")
    if not isinstance(maintainer, dict):
        raise ValueError("project.json needs an object at maintainer")
    if maintainer.get("public_email") not in (None, "") or maintainer.get("orcid") not in (None, ""):
        raise ValueError("The public profile currently permits GitHub only; review any email or ORCID separately before adding it.")
    profile = maintainer.get("public_profile")
    if not isinstance(profile, dict):
        raise ValueError("project.json needs maintainer.public_profile")
    inspect_private_fields(maintainer, "maintainer")
    required = ("bio_zh", "bio_en", "research_interests", "education", "publications", "patents", "projects", "honors", "public_links")
    missing = [key for key in required if not profile.get(key)]
    if missing:
        raise ValueError("Missing public profile fields: " + ", ".join(missing))
    if len(profile["publications"]) != 9:
        raise ValueError("The audited profile expects nine publication records.")
    if not maintainer.get("github_username"):
        raise ValueError("A public GitHub username is required.")
    return maintainer, profile


def education_lines(profile: dict[str, Any], language: str) -> list[str]:
    lines = []
    for item in profile["education"]:
        degree = item[f"degree_{language}"]
        school = item[f"school_{language}"]
        field = item[f"field_{language}"]
        dates = item[f"dates_{language}"]
        separator = "；" if language == "zh" else "; "
        lines.append(f"- **{markdown(dates)} · {markdown(degree)}** — {markdown(school)}{separator}{markdown(field)}")
    return lines


def citation(item: dict[str, Any], language: str, include_source: bool = True) -> str:
    year = markdown(item["year"])
    authors = markdown(item["authors"]).rstrip(". ")
    title = markdown(item["title"]).rstrip("。. ")
    journal = markdown(item["journal"])
    detail = markdown(item["detail"])
    text = f"{authors}. {title}. *{journal}* {detail} ({year})."
    role = item.get(f"role_{language}")
    if role:
        text += f" **{markdown(role)}**."
    if include_source:
        if item.get("doi"):
            text += f" DOI: {link(item['doi'], 'https://doi.org/' + item['doi'])}."
        if item.get("source_url"):
            text += f" {link(item.get('source_label', 'Record'), item['source_url'])}."
    return text


def achievement_lines(profile: dict[str, Any], language: str) -> list[str]:
    lines: list[str] = []
    for project in profile["projects"]:
        name = project[f"name_{language}"]
        role = project[f"role_{language}"]
        recognition = project[f"recognition_{language}"]
        official = link("HKUST (Guangzhou)" if language == "en" else "港科大（广州）官方报道", project["official_url"])
        team = link("iGEM team wiki", project["team_url"])
        lines.append(f"- **{markdown(project['year'])} · {markdown(name)}** — {markdown(role)}. {markdown(recognition)} {official} · {team}.")
    for patent in profile["patents"]:
        title = patent[f"title_{language}"]
        role = patent[f"role_{language}"]
        lines.append(
            f"- **{markdown(patent['year'])} · {markdown(patent['number'])}** — "
            f"{markdown(title)}. {markdown(role)}. {link('Patent record' if language == 'en' else '专利记录', patent['url'])}."
        )
    return lines


def honors_lines(profile: dict[str, Any], language: str) -> list[str]:
    return [
        f"- **{markdown(item[f'period_{language}'])} · {markdown(item[f'title_{language}'])}** — "
        f"{markdown(item[f'summary_{language}'])}"
        for item in profile["honors"]
    ]


def render_page(maintainer: dict[str, Any], profile: dict[str, Any]) -> str:
    name_en = markdown(maintainer["name_en"])
    name_zh = markdown(maintainer["name_zh"])
    github = link("GitHub", f"https://github.com/{maintainer['github_username']}")
    interests_zh = "\n".join(f"- {markdown(item['zh'])}" for item in profile["research_interests"])
    interests_en = "\n".join(f"- {markdown(item['en'])}" for item in profile["research_interests"])
    featured = next(item for item in profile["publications"] if item.get("featured"))
    all_zh = "\n".join(f"{index}. {citation(item, 'zh')}" for index, item in enumerate(profile["publications"], 1))
    all_en = "\n".join(f"{index}. {citation(item, 'en')}" for index, item in enumerate(profile["publications"], 1))
    education_zh = "\n".join(education_lines(profile, "zh"))
    education_en = "\n".join(education_lines(profile, "en"))
    achievements_zh = "\n".join(achievement_lines(profile, "zh"))
    achievements_en = "\n".join(achievement_lines(profile, "en"))
    honors_zh = "\n".join(honors_lines(profile, "zh"))
    honors_en = "\n".join(honors_lines(profile, "en"))
    front_title = json.dumps("作者简介 / Author profile", ensure_ascii=False)
    front_description = json.dumps("何帅涵（Shuaihan He）的中英文简介、教育经历、研究成果与公开简历。", ensure_ascii=False)
    return f"""---
title: {front_title}
description: {front_description}
search: false
---

# {name_zh} · {name_en}

{github} · [下载公开简历 / Download public CV](public-cv.md)

::: {{.panel-tabset}}

## 中文

{markdown(profile['bio_zh'])}

### 研究兴趣

{interests_zh}

### 教育经历

{education_zh}

### 代表成果

#### 代表论文

{citation(featured, 'zh')}

#### 专利与项目

{achievements_zh}

### 奖项与荣誉

{honors_zh}

### 发表论文

<details>
<summary>完整发表论文列表 / Full publication list</summary>

{all_zh}
</details>

## English

{markdown(profile['bio_en'])}

### Research interests

{interests_en}

### Education

{education_en}

### Selected contributions

#### Featured article

{citation(featured, 'en')}

#### Patents and project

{achievements_en}

### Honors

{honors_en}

### Publications

<details>
<summary>Full publication list / 完整发表论文列表</summary>

{all_en}
</details>

:::

"""
def render_cv(maintainer: dict[str, Any], profile: dict[str, Any]) -> str:
    github = link("GitHub", f"https://github.com/{maintainer['github_username']}")
    education = "\n".join(education_lines(profile, "en"))
    education_zh = "\n".join(education_lines(profile, "zh"))
    contributions_en = "\n".join(achievement_lines(profile, "en"))
    contributions_zh = "\n".join(achievement_lines(profile, "zh"))
    honors_en = "\n".join(honors_lines(profile, "en"))
    honors_zh = "\n".join(honors_lines(profile, "zh"))
    pubs = "\n".join(f"{index}. {citation(item, 'en')}" for index, item in enumerate(profile["publications"], 1))
    return f"""# {markdown(maintainer['name_en'])}（{markdown(maintainer['name_zh'])}）

**Public CV · {markdown(profile['updated_on'])}**  
{github}

## Profile / 个人简介

{markdown(profile['bio_en'])}

{markdown(profile['bio_zh'])}

## Research interests / 研究兴趣

{chr(10).join(f"- {markdown(item['en'])} / {markdown(item['zh'])}" for item in profile['research_interests'])}

## Education / 教育经历

{education}

{education_zh}

## Selected contributions / 代表成果

{contributions_en}

{contributions_zh}

## Honors / 奖项与荣誉

{honors_en}

{honors_zh}

## Publications / 发表论文

{pubs}

---

Personal project profile. Institutional affiliations identify the author and do not imply institutional endorsement.  
个人学术资料由作者维护；单位信息仅用于作者身份说明，不代表学校或研究所的官方发布与认可。
"""


def generated_files() -> dict[Path, str]:
    project = json.loads(PROJECT.read_text(encoding="utf-8"))
    maintainer, profile = validate(project)
    page = render_page(maintainer, profile)
    cv = render_cv(maintainer, profile)
    for path, text in ((PAGE, page), (CV, cv)):
        if PHONE_VALUE.search(text) or EMAIL_VALUE.search(text) or IDENTITY_VALUE.search(text):
            raise ValueError(f"Generated output contains a phone or email value: {path.relative_to(ROOT)}")
    if re.search(r"\bGPA\b|成绩单|身份证|护照", page + cv, re.IGNORECASE):
        raise ValueError("Generated output contains a restricted academic or identity item.")
    return {PAGE: page, CV: cv}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="check generated files without writing them")
    args = parser.parse_args(argv)
    files = generated_files()
    if args.check:
        stale = [path.relative_to(ROOT).as_posix() for path, expected in files.items() if not path.exists() or path.read_text(encoding="utf-8") != expected]
        if stale:
            print("Generated profile files are stale: " + ", ".join(stale), file=sys.stderr)
            return 1
        print("Profile source and generated page/CV are in sync; privacy checks passed.")
        return 0
    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            path.write_text(content, encoding="utf-8", newline="\n")
    print("Generated profile/index.qmd and profile/public-cv.md from project.json; privacy checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

