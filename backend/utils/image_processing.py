import io
from typing import Tuple

from PIL import Image, UnidentifiedImageError

from ..core.exceptions import InvalidInputException

MEGABYTE = 1024 * 1024


class ImageValidator:
    def __init__(self, max_size_mb: float, max_dims: Tuple[int, int], allowed_formats: set[str]):
        self.max_size_bytes = int(max_size_mb * MEGABYTE)
        self.max_width, self.max_height = max_dims
        self.allowed_formats = allowed_formats

    async def validate_and_sanitize(self, file_stream: io.BytesIO) -> bytes:
        """
        Validate and sanitize an in-memory image.
        Returns the sanitized image as bytes.
        """
        file_stream.seek(0, 2)
        file_size = file_stream.tell()
        if file_size > self.max_size_bytes:
            raise InvalidInputException(
                f"Image file size ({file_size / MEGABYTE:.2f} MB) exceeds the limit of "
                f"{self.max_size_bytes / MEGABYTE:.2f} MB."
            )
        file_stream.seek(0)

        try:
            with Image.open(file_stream) as img:
                try:
                    img.load()
                except Exception as e:
                    raise InvalidInputException(
                        f"Failed to fully load image data. It may be corrupt. Error: {e}"
                    )

                if getattr(img, "is_animated", False):
                    raise InvalidInputException("Animated images are not supported.")

                if img.format not in self.allowed_formats:
                    raise InvalidInputException(
                        f"Unsupported image format: {img.format}. "
                        f"Allowed formats: {', '.join(self.allowed_formats)}."
                    )

                if img.width > self.max_width or img.height > self.max_height:
                    raise InvalidInputException(
                        f"Image dimensions ({img.width}x{img.height}) exceed the limit of "
                        f"{self.max_width}x{self.max_height}."
                    )

                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGB")

                output_buffer = io.BytesIO()
                img.save(output_buffer, format="PNG")
                sanitized_bytes = output_buffer.getvalue()

        except UnidentifiedImageError:
            raise InvalidInputException(
                "Could not identify image file. The file may be corrupt or not a valid image."
            )
        except Exception as e:
            if isinstance(e, InvalidInputException):
                raise
            raise InvalidInputException(
                f"An unexpected error occurred while processing the image: {e}"
            )

        return sanitized_bytes