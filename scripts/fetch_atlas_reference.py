#!/usr/bin/env python3
"""Fetch and safely activate a pinned ExperiAtlas public reference archive."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PIN = ROOT / "atlas" / "reference-release.json"
DEFAULT_DESTINATION = ROOT / "_site" / "atlas" / "reference"

CHUNK_BYTES = 8 * 1024 * 1024
MAX_MEMBER_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 930_000_000
MAX_ARCHIVE_BYTES = MAX_TOTAL_BYTES + (64 * 1024 * 1024)
MAX_FILES = 5_000
EXPECTED_BUCKETS = 4_096

BUCKET_ID_RE = re.compile(r"(?:[a-f0-9]{3}|[a-f0-9]{12})\Z")
BUCKET_MEMBER_RE = re.compile(
    r"reference/buckets/(?:[a-f0-9]{3}|[a-f0-9]{12})\.json\.gz\Z"
)
SHA256_RE = re.compile(r"[a-f0-9]{64}\Z")
RELEASE_PATH_RE = re.compile(
    r"/heshuaihan/ExperiTome/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\Z"
)
ASSET_REDIRECT_HOSTS = frozenset(
    {"release-assets.githubusercontent.com", "objects.githubusercontent.com"}
)


class ValidationError(Exception):
    """Raised when a pin, archive, or manifest fails closed validation."""


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise ValidationError(f"invalid JSON numeric constant: {value}")


def _read_json(path: Path, *, max_bytes: int) -> dict[str, object]:
    size = path.stat().st_size
    if size > max_bytes:
        raise ValidationError(f"JSON file exceeds {max_bytes} bytes: {path.name}")
    try:
        raw = path.read_bytes()
        parsed = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_json_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"invalid UTF-8 JSON in {path.name}: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValidationError(f"expected a JSON object in {path.name}")
    return parsed


def _is_plain_integer(value: object, *, minimum: int = 0) -> bool:
    return type(value) is int and value >= minimum


def _validate_release_url(value: object) -> str:
    if not isinstance(value, str):
        raise ValidationError("pin url must be a string")
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ValidationError("pin url is malformed") from exc
    if (
        parsed.scheme != "https"
        or parsed.hostname != "github.com"
        or parsed.username is not None
        or parsed.password is not None
        or port is not None
        or parsed.query
        or parsed.fragment
        or not RELEASE_PATH_RE.fullmatch(parsed.path)
    ):
        raise ValidationError(
            "pin url must be an HTTPS GitHub ExperiTome release asset URL"
        )
    return value


def _load_pin(path: Path) -> dict[str, object]:
    pin = _read_json(path, max_bytes=64 * 1024)
    required = {"url", "sha256", "bytes", "manifest_sha256", "snapshot"}
    if set(pin) != required:
        raise ValidationError(
            "pin must contain exactly url, sha256, bytes, manifest_sha256, snapshot"
        )
    _validate_release_url(pin["url"])
    for field in ("sha256", "manifest_sha256"):
        value = pin[field]
        if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
            raise ValidationError(f"pin {field} must be a lowercase SHA-256 hex digest")
    if not _is_plain_integer(pin["bytes"], minimum=1):
        raise ValidationError("pin bytes must be a positive integer")
    if pin["bytes"] > MAX_ARCHIVE_BYTES:
        raise ValidationError("pinned archive exceeds the maximum accepted size")
    if not isinstance(pin["snapshot"], str) or not pin["snapshot"]:
        raise ValidationError("pin snapshot must be a non-empty string")
    return pin


def _valid_asset_redirect(url: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and parsed.hostname in ASSET_REDIRECT_HOSTS
        and parsed.username is None
        and parsed.password is None
        and port is None
        and not parsed.fragment
    )


class _ReleaseAssetRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        target = urllib.parse.urljoin(req.full_url, newurl)
        if not _valid_asset_redirect(target):
            raise urllib.error.HTTPError(
                target,
                code,
                "redirect target is outside the allowed GitHub release asset hosts",
                headers,
                fp,
            )
        return super().redirect_request(req, fp, code, msg, headers, target)


def _copy_and_verify_archive(
    pin: dict[str, object], archive_path: Path, local_archive: Path | None
) -> None:
    digest = hashlib.sha256()
    byte_count = 0

    with contextlib.ExitStack() as stack:
        if local_archive is not None:
            if local_archive.is_symlink() or not local_archive.is_file():
                raise ValidationError("--local-archive must be a regular file")
            source = stack.enter_context(local_archive.open("rb"))
        else:
            opener = urllib.request.build_opener(_ReleaseAssetRedirectHandler())
            request = urllib.request.Request(
                str(pin["url"]),
                headers={"User-Agent": "ExperiTome-static-reference-fetch/1"},
            )
            try:
                source = stack.enter_context(opener.open(request, timeout=120))
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                raise ValidationError(f"could not download pinned GitHub release asset: {exc}") from exc

        with archive_path.open("wb") as target:
            while True:
                chunk = source.read(CHUNK_BYTES)
                if not chunk:
                    break
                byte_count += len(chunk)
                if byte_count > int(pin["bytes"]):
                    raise ValidationError("archive is larger than the pinned byte count")
                if byte_count > MAX_ARCHIVE_BYTES:
                    raise ValidationError("archive exceeds the maximum accepted size")
                digest.update(chunk)
                target.write(chunk)

    if byte_count != pin["bytes"]:
        raise ValidationError(
            f"archive byte count mismatch: expected {pin['bytes']}, received {byte_count}"
        )
    if digest.hexdigest() != pin["sha256"]:
        raise ValidationError("archive SHA-256 does not match the pin")


def _validate_archive_members(
    archive: tarfile.TarFile,
) -> tuple[list[tarfile.TarInfo], dict[str, tarfile.TarInfo], int]:
    members = archive.getmembers()
    if len(members) > MAX_FILES:
        raise ValidationError(f"archive has more than {MAX_FILES} members")

    seen: set[str] = set()
    by_name: dict[str, tarfile.TarInfo] = {}
    total_bytes = 0
    for member in members:
        name = member.name
        if not member.isreg() or getattr(member, "sparse", None):
            raise ValidationError(f"archive member is not a plain regular file: {name!r}")
        if (
            not name
            or "\\" in name
            or "\x00" in name
            or name.startswith("/")
            or PurePosixPath(name).is_absolute()
            or any(part in {"", ".", ".."} for part in name.split("/"))
        ):
            raise ValidationError(f"unsafe archive member path: {name!r}")
        if name != "reference/manifest.json" and not BUCKET_MEMBER_RE.fullmatch(name):
            raise ValidationError(f"unexpected archive member path: {name!r}")
        if name in seen:
            raise ValidationError(f"duplicate archive member path: {name!r}")
        seen.add(name)
        by_name[name] = member
        if member.size < 0 or member.size > MAX_MEMBER_BYTES:
            raise ValidationError(f"archive member exceeds {MAX_MEMBER_BYTES} bytes: {name}")
        total_bytes += member.size
        if total_bytes > MAX_TOTAL_BYTES:
            raise ValidationError(f"archive file total exceeds {MAX_TOTAL_BYTES} bytes")

    if "reference/manifest.json" not in by_name:
        raise ValidationError("archive is missing reference/manifest.json")
    return members, by_name, total_bytes


def _extract_members(
    archive: tarfile.TarFile, members: list[tarfile.TarInfo], extraction_root: Path
) -> None:
    for member in members:
        relative = PurePosixPath(member.name)
        destination = extraction_root.joinpath(*relative.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        source = archive.extractfile(member)
        if source is None:
            raise ValidationError(f"could not read archive member: {member.name}")
        written = 0
        with source, destination.open("xb") as target:
            while written < member.size:
                chunk = source.read(min(CHUNK_BYTES, member.size - written))
                if not chunk:
                    raise ValidationError(f"truncated archive member: {member.name}")
                target.write(chunk)
                written += len(chunk)
            if source.read(1):
                raise ValidationError(f"archive member exceeds its declared size: {member.name}")
        if written != member.size:
            raise ValidationError(f"archive member size mismatch: {member.name}")


def _validate_manifest_and_buckets(
    pin: dict[str, object],
    reference_root: Path,
    archive_members: dict[str, tarfile.TarInfo],
    archive_total_bytes: int,
) -> None:
    manifest_path = reference_root / "manifest.json"
    manifest_digest = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    if manifest_digest != pin["manifest_sha256"]:
        raise ValidationError("manifest SHA-256 does not match the pin")

    manifest = _read_json(manifest_path, max_bytes=MAX_MEMBER_BYTES)
    if manifest.get("format") != "experiatlas-static-1":
        raise ValidationError("manifest format is not experiatlas-static-1")
    if manifest.get("snapshot") != pin["snapshot"]:
        raise ValidationError("manifest snapshot does not match the pin")

    total_objects = manifest.get("objects")
    if not _is_plain_integer(total_objects, minimum=1):
        raise ValidationError("manifest objects must be a positive integer")
    object_counts = manifest.get("object_counts")
    if not isinstance(object_counts, dict) or not object_counts:
        raise ValidationError("manifest object_counts must be a non-empty object")
    if any(
        not isinstance(key, str) or not key or not _is_plain_integer(value)
        for key, value in object_counts.items()
    ):
        raise ValidationError("manifest object_counts must contain non-negative integers")
    if sum(object_counts.values()) != total_objects:
        raise ValidationError("manifest object_counts do not sum to objects")

    buckets = manifest.get("buckets")
    if not isinstance(buckets, dict) or len(buckets) != EXPECTED_BUCKETS:
        raise ValidationError(f"manifest must describe exactly {EXPECTED_BUCKETS} buckets")

    bucket_object_total = 0
    bucket_byte_total = 0
    expected_members = {"reference/manifest.json"}
    for bucket_id, entry in buckets.items():
        if not isinstance(bucket_id, str) or not BUCKET_ID_RE.fullmatch(bucket_id):
            raise ValidationError(f"invalid bucket identifier: {bucket_id!r}")
        if not isinstance(entry, dict):
            raise ValidationError(f"manifest bucket {bucket_id} must be an object")
        expected_relative = f"buckets/{bucket_id}.json.gz"
        if entry.get("path") != expected_relative:
            raise ValidationError(f"manifest bucket {bucket_id} has an unexpected path")
        bucket_bytes = entry.get("bytes")
        decoded_bytes = entry.get("decoded_bytes")
        bucket_objects = entry.get("objects")
        bucket_sha = entry.get("sha256")
        if not _is_plain_integer(bucket_bytes) or not _is_plain_integer(decoded_bytes):
            raise ValidationError(f"manifest bucket {bucket_id} has invalid byte counts")
        if bucket_bytes > MAX_MEMBER_BYTES:
            raise ValidationError(f"manifest bucket {bucket_id} exceeds the member size limit")
        if not _is_plain_integer(bucket_objects):
            raise ValidationError(f"manifest bucket {bucket_id} has an invalid object count")
        if not isinstance(bucket_sha, str) or not SHA256_RE.fullmatch(bucket_sha):
            raise ValidationError(f"manifest bucket {bucket_id} has an invalid SHA-256")

        archive_name = f"reference/{expected_relative}"
        expected_members.add(archive_name)
        member = archive_members.get(archive_name)
        if member is None:
            raise ValidationError(f"archive is missing bucket file: {archive_name}")
        bucket_path = reference_root / expected_relative
        if member.size != bucket_bytes or bucket_path.stat().st_size != bucket_bytes:
            raise ValidationError(f"bucket byte count mismatch: {archive_name}")
        if _sha256_file(bucket_path) != bucket_sha:
            raise ValidationError(f"bucket SHA-256 mismatch: {archive_name}")

        bucket_object_total += bucket_objects
        bucket_byte_total += bucket_bytes

    if set(archive_members) != expected_members:
        raise ValidationError("archive contains files not described by the manifest")
    compressed_bytes = manifest.get("compressed_bytes")
    if not _is_plain_integer(compressed_bytes):
        raise ValidationError("manifest compressed_bytes must be a non-negative integer")
    if bucket_byte_total != compressed_bytes:
        raise ValidationError("manifest compressed_bytes does not match bucket files")
    if bucket_object_total != total_objects:
        raise ValidationError("bucket object counts do not sum to manifest objects")
    if manifest_path.stat().st_size + bucket_byte_total != archive_total_bytes:
        raise ValidationError("archive file total does not match manifest and bucket files")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(CHUNK_BYTES)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _check_destination(destination: Path) -> None:
    if not destination.name or destination == destination.parent:
        raise ValidationError("destination must name a directory below its parent")
    if destination.is_symlink():
        raise ValidationError(f"destination is a symbolic link: {destination}")
    if not destination.exists():
        return
    if not destination.is_dir():
        raise ValidationError(f"destination exists and is not a directory: {destination}")
    try:
        next(destination.iterdir())
    except StopIteration:
        return
    raise ValidationError(f"destination exists and is non-empty: {destination}")


def _activate(staged_reference: Path, destination: Path) -> None:
    _check_destination(destination)
    if destination.exists():
        destination.rmdir()
    try:
        os.rename(staged_reference, destination)
    except OSError as exc:
        raise ValidationError(f"could not atomically activate reference directory: {exc}") from exc


def fetch_reference(
    pin_path: Path, destination: Path, local_archive: Path | None = None
) -> None:
    pin = _load_pin(pin_path)
    _check_destination(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix=".atlas-reference-stage-", dir=str(destination.parent)
    ) as temporary_directory:
        stage = Path(temporary_directory)
        archive_path = stage / "release.tar.gz"
        extraction_root = stage / "extracted"
        extraction_root.mkdir()

        _copy_and_verify_archive(pin, archive_path, local_archive)
        try:
            with tarfile.open(archive_path, mode="r:gz") as archive:
                members, by_name, total_bytes = _validate_archive_members(archive)
                _extract_members(archive, members, extraction_root)
        except (tarfile.TarError, OSError, EOFError) as exc:
            raise ValidationError(f"invalid or unreadable tar.gz archive: {exc}") from exc

        staged_reference = extraction_root / "reference"
        if not staged_reference.is_dir():
            raise ValidationError("archive did not produce a reference directory")
        _validate_manifest_and_buckets(pin, staged_reference, by_name, total_bytes)
        _activate(staged_reference, destination)


def _resolve_path(value: str | None, default: Path) -> Path:
    path = default if value is None else Path(value).expanduser()
    if not path.is_absolute():
        path = ROOT / path
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pin", help=f"pinned release metadata JSON (default: {DEFAULT_PIN})"
    )
    parser.add_argument(
        "--destination",
        help=f"directory to activate (default: {DEFAULT_DESTINATION})",
    )
    parser.add_argument(
        "--local-archive",
        help="validate this local tar.gz instead of downloading the pinned URL",
    )
    args = parser.parse_args(argv)

    pin_path = _resolve_path(args.pin, DEFAULT_PIN)
    destination = _resolve_path(args.destination, DEFAULT_DESTINATION)
    local_archive = (
        _resolve_path(args.local_archive, ROOT / "unused-local-archive")
        if args.local_archive is not None
        else None
    )
    try:
        fetch_reference(pin_path, destination, local_archive)
    except (ValidationError, OSError) as exc:
        print(f"fetch_atlas_reference: error: {exc}", file=sys.stderr)
        return 1
    print(f"Activated pinned Atlas reference snapshot {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
