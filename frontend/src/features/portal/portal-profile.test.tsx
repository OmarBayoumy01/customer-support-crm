import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { PortalProfile } from '@crm/shared';

import i18n from '@/i18n';
import { AppProviders } from '@/app/providers';
import { http } from '@/lib/api-client';
import { PortalProfileDialog } from './portal-profile-dialog';

const realAdapter = http.defaults.adapter;

const INITIAL_PROFILE: PortalProfile = {
  id: '01923456-89ab-7cde-8f01-2345678900a1',
  email: 'customer@crm.local',
  firstName: 'Omar',
  lastName: 'Nasser',
  phone: '+966501234567',
  companyName: 'Nasser Trading',
  preferredLocale: 'EN',
  preferredChannel: 'EMAIL',
};

let sentRequests: InternalAxiosRequestConfig[] = [];

function setupMockAdapter(profile: PortalProfile = INITIAL_PROFILE) {
  sentRequests = [];

  http.defaults.adapter = (async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    sentRequests.push(config);

    const method = config.method?.toLowerCase();

    if (config.url === '/portal/profile' && method === 'get') {
      return {
        data: { data: profile },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    }

    if (config.url === '/portal/profile' && method === 'patch') {
      const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
      const updated: PortalProfile = {
        ...profile,
        ...body,
      };

      return {
        data: { data: updated },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    }

    throw new AxiosError(`Unhandled ${config.method ?? ''} ${config.url ?? ''}`);
  }) as AxiosAdapter;
}

describe('PortalProfileDialog', () => {
  beforeEach(async () => {
    setupMockAdapter();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    if (realAdapter === undefined) {
      delete http.defaults.adapter;
    } else {
      http.defaults.adapter = realAdapter;
    }
  });

  test('renders trigger button and opens dialog with current profile details', async () => {
    const user = userEvent.setup();

    render(
      <AppProviders>
        <PortalProfileDialog />
      </AppProviders>,
    );

    const trigger = screen.getByRole('button', { name: /my profile/i });
    expect(trigger).toBeInTheDocument();

    await user.click(trigger);

    expect(await screen.findByDisplayValue('Omar')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Nasser')).toBeInTheDocument();
    expect(screen.getByDisplayValue('customer@crm.local')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+966501234567')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Nasser Trading')).toBeInTheDocument();
  });

  test('submitting updated profile data sends PATCH request and displays success message', async () => {
    const user = userEvent.setup();

    render(
      <AppProviders>
        <PortalProfileDialog />
      </AppProviders>,
    );

    await user.click(screen.getByRole('button', { name: /my profile/i }));

    const firstNameInput = await screen.findByDisplayValue('Omar');
    await user.clear(firstNameInput);
    await user.type(firstNameInput, 'OmarUpdated');

    const phoneInput = screen.getByDisplayValue('+966501234567');
    await user.clear(phoneInput);
    await user.type(phoneInput, '+966509999999');

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    expect(await screen.findByText(/your profile has been updated/i)).toBeInTheDocument();

    const patchReq = sentRequests.find((r) => r.method === 'patch');
    expect(patchReq).toBeDefined();
    const data = typeof patchReq?.data === 'string' ? JSON.parse(patchReq.data) : patchReq?.data;
    expect(data.firstName).toBe('OmarUpdated');
    expect(data.phone).toBe('+966509999999');
  });
});
