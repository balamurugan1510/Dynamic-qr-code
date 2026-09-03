import io
import qrcode
from qrcode.image.pure import PyPNGImage


def generate_qr_png(redirect_url: str) -> bytes:
    """
    Generate a QR code PNG in-memory for the given redirect URL.
    Returns raw PNG bytes.
    Uses ERROR_CORRECT_H for maximum error correction (supports logo overlay later).
    """
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=4,
    )
    qr.add_data(redirect_url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="#1a0533", back_color="#ffffff")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer.getvalue()
