const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

function getHeaders() {
  return {
    'Authorization': `Bearer ${process.env.GHL_API_TOKEN ?? ''}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };
}

export async function createGHLContact(email: string, name?: string) {
  try {
    const res = await fetch(`${GHL_BASE_URL}/contacts/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        email,
        name: name ?? email?.split('@')?.[0] ?? 'User',
        locationId: process.env.GHL_LOCATION_ID ?? '',
        source: 'Ad Launch',
        tags: ['ad-launch', 'free-trial'],
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { success: res.ok, data, contactId: data?.contact?.id ?? null };
  } catch (err: any) {
    console.error('GHL create contact error:', err?.message);
    return { success: false, data: null, contactId: null };
  }
}

export async function sendGHLEmail(contactId: string, subject: string, htmlBody: string) {
  try {
    const res = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        type: 'Email',
        contactId,
        subject,
        html: htmlBody,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { success: res.ok, data };
  } catch (err: any) {
    console.error('GHL send email error:', err?.message);
    return { success: false, data: null };
  }
}

export async function sendConfirmationEmail(email: string, confirmationToken: string, baseUrl: string) {
  const contactResult = await createGHLContact(email);
  const confirmLink = `${baseUrl}/confirm?token=${confirmationToken}`;
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #2563EB; margin: 0;">Ad Launch</h1>
      </div>
      <h2 style="color: #1E293B;">Confirm Your Email</h2>
      <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hi there!</p>
      <p style="color: #475569; font-size: 16px; line-height: 1.6;">Click the button below to confirm your email and download your <strong>3 free ads</strong>:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${confirmLink}" style="background-color: #2563EB; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">Confirm My Email</a>
      </div>
      <p style="color: #94A3B8; font-size: 14px;">If the button doesn't work, copy and paste this link:<br/>${confirmLink}</p>
      <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;"/>
      <p style="color: #94A3B8; font-size: 12px; text-align: center;">Thanks,<br/>The Ad Launch Team</p>
    </div>
  `;

  if (contactResult.contactId) {
    return sendGHLEmail(contactResult.contactId, 'Confirm your email - Ad Launch', htmlBody);
  }
  return { success: false, data: null, error: 'Failed to create contact' };
}
