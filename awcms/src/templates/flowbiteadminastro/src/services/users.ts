/* eslint-disable no-param-reassign */
import { faker } from '@faker-js/faker';
import { RANDOMIZE } from '../app/constants.js';
import type { Users } from '../types/entities.js';

import usersStaticJSON from '../../data/users.json' assert { type: 'json' };

const usersStaticData: Users = usersStaticJSON;

export function getUsers(randomize = RANDOMIZE) {
	console.log('getUsers');

	const result = randomize
		? usersStaticData.map((user) => {
			user.name = faker.name.fullName();
			user.email = faker.internet.email();
			user.position = faker.name.jobTitle();
			user.country = faker.address.country();
			return user;
		})
		: usersStaticData;

	return result;
}
